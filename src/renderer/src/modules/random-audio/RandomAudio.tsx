import { useEffect, useMemo, useRef, useState } from 'react'
import type { MediaInfo } from '@shared/types'
import type { RandomAudioFormat, RandomAudioStartPayload } from '@shared/modules/random-audio'
import { fmtBytes, secToHms } from '@shared/time'
import { invoke, invokeSilent, kvGet, kvSet, pathForFile, pickFiles, pickFolder, probe, statPath } from '../../api'
import { Check, Field, FolderInput, NumInput, Select } from '../../components/Field'
import { TaskTable } from '../../components/TaskTable'
import { useT } from '../../i18n'
import { useSettings } from '../../store/settings'
import { useUi } from '../../store/ui'
import './styles.css'

interface Tile {
  path: string
  /** null = đang probe hoặc probe lỗi */
  info: MediaInfo | null
  /** data URI ảnh sóng âm; null = chưa có / lỗi */
  wave: string | null
  waveLoading: boolean
}

const baseName = (p: string): string => p.split(/[\\/]/).pop() ?? p

const AUDIO_EXTS = ['mp3', 'm4a', 'aac', 'wav', 'flac', 'ogg', 'oga', 'opus', 'wma', 'aiff', 'aif', 'ac3', 'mka']
const AUDIO_FILTERS = [
  { name: 'Âm thanh', extensions: AUDIO_EXTS },
  { name: 'Tất cả file', extensions: ['*'] }
]
const AUDIO_EXT_RE = new RegExp(`\\.(${AUDIO_EXTS.join('|')})$`, 'i')

/** Giới hạn số tác vụ async chạy song song (tránh spawn hàng trăm ffprobe/ffmpeg cùng lúc). */
function makeLimiter(limit: number): (fn: () => Promise<void>) => void {
  let active = 0
  const q: Array<() => void> = []
  const pump = (): void => {
    while (active < limit && q.length) {
      const job = q.shift()!
      active++
      job()
    }
  }
  return (fn) => {
    q.push(() => {
      void fn().finally(() => {
        active--
        pump()
      })
    })
    pump()
  }
}

/** Fisher-Yates: trả về bản sao đã trộn ngẫu nhiên. */
function shuffle<T>(arr: T[]): T[] {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

/**
 * Module Ghép Âm Thanh Ngẫu Nhiên (song song với Ghép Video Ngẫu Nhiên):
 * - Kéo-thả / chọn thư mục audio → kho tile (sóng âm + thông tin).
 * - Kéo-thả tile để đổi thứ tự; N file đầu (🔒) giữ nguyên thứ tự đó.
 * - Chọn số file trong bản ghép + số bản xuất → phần còn lại chọn NGẪU NHIÊN, KHÔNG trùng.
 */
export default function RandomAudio(): React.JSX.Element {
  const t = useT()
  const pushToast = useUi((s) => s.pushToast)
  const defaultOutputDir = useSettings((s) => s.settings?.outputDir ?? '')

  const [tiles, setTiles] = useState<Tile[]>([])
  const [outputDir, setOutputDir] = useState(defaultOutputDir)
  const [leadCount, setLeadCount] = useState(1)
  const [outCount, setOutCount] = useState(3)
  const [variants, setVariants] = useState(1)
  const [forceReencode, setForceReencode] = useState(false)
  const [format, setFormat] = useState<RandomAudioFormat>('mp3')
  const [jobs, setJobs] = useState<string[][] | null>(null)
  const [busy, setBusy] = useState(false)
  const [dropOver, setDropOver] = useState(false)

  const [dragOver, setDragOver] = useState<number | null>(null)
  const dragFrom = useRef<number | null>(null)

  useEffect(() => {
    let alive = true
    void kvGet<string>('random-audio', 'outputDir', defaultOutputDir).then((saved) => {
      if (alive) setOutputDir(saved)
    })
    return () => {
      alive = false
    }
  }, [defaultOutputDir])

  const changeOutputDir = (value: string): void => {
    setOutputDir(value)
    void kvSet('random-audio', 'outputDir', value)
  }

  // Ref đọc tiles hiện tại trong event handler (dedupe khi thêm file) không cần re-bind.
  const tilesRef = useRef(tiles)
  tilesRef.current = tiles

  // Limiter bền vững theo vòng đời component.
  const probeLimitRef = useRef<((fn: () => Promise<void>) => void) | null>(null)
  const waveLimitRef = useRef<((fn: () => Promise<void>) => void) | null>(null)
  if (!probeLimitRef.current) probeLimitRef.current = makeLimiter(6)
  if (!waveLimitRef.current) waveLimitRef.current = makeLimiter(3)

  const patchTile = (p: string, patch: Partial<Tile>): void =>
    setTiles((prev) => prev.map((it) => (it.path === p ? { ...it, ...patch } : it)))

  const loadOne = (p: string): void => {
    probeLimitRef.current!(async () => {
      try {
        const info = await probe(p)
        patchTile(p, { info })
      } catch {
        /* giữ info = null */
      }
    })
    waveLimitRef.current!(async () => {
      try {
        const url = await invokeSilent<string>('mod:random-audio:wave', { path: p })
        patchTile(p, { wave: url, waveLoading: false })
      } catch {
        patchTile(p, { waveLoading: false })
      }
    })
  }

  const addFiles = (paths: string[]): void => {
    const have = new Set(tilesRef.current.map((t) => t.path))
    const fresh = paths.filter((p, idx, arr) => !have.has(p) && arr.indexOf(p) === idx)
    if (!fresh.length) return
    setTiles((prev) => [
      ...prev,
      ...fresh.map((p): Tile => ({ path: p, info: null, wave: null, waveLoading: true }))
    ])
    for (const p of fresh) loadOne(p)
  }

  // ---- Nạp file/thư mục audio (không dùng FileDrop vì core:scanDir chỉ quét video) ----
  const browseFiles = async (): Promise<void> => {
    const paths = await pickFiles({ multi: true, filters: AUDIO_FILTERS })
    if (paths.length) addFiles(paths)
  }
  const browseFolder = async (): Promise<void> => {
    const dir = await pickFolder()
    if (!dir) return
    const files = await invokeSilent<string[]>('mod:random-audio:scanDir', { dir })
    if (files.length) addFiles(files)
    else pushToast('info', t('Thư mục không có file âm thanh nào', 'No audio files in that folder'))
  }
  const handleDrop = async (e: React.DragEvent): Promise<void> => {
    e.preventDefault()
    setDropOver(false)
    const dropped = Array.from(e.dataTransfer.files)
    const out: string[] = []
    for (const f of dropped) {
      const p = pathForFile(f)
      if (!p) continue
      const st = await statPath(p)
      if (st.isDirectory) {
        out.push(...(await invokeSilent<string[]>('mod:random-audio:scanDir', { dir: p })))
      } else if (st.exists && AUDIO_EXT_RE.test(p)) {
        out.push(p)
      }
    }
    if (out.length) addFiles(out)
  }

  const removeAt = (idx: number): void => setTiles((prev) => prev.filter((_, i) => i !== idx))
  const clearAll = (): void => setTiles([])

  const move = (idx: number, dir: -1 | 1): void =>
    setTiles((prev) => {
      const j = idx + dir
      if (j < 0 || j >= prev.length) return prev
      const next = [...prev]
      ;[next[idx], next[j]] = [next[j], next[idx]]
      return next
    })

  const dropReorder = (to: number): void => {
    const from = dragFrom.current
    dragFrom.current = null
    setDragOver(null)
    if (from === null || from === to) return
    setTiles((prev) => {
      const next = [...prev]
      const [m] = next.splice(from, 1)
      next.splice(to, 0, m)
      return next
    })
  }

  const poolSize = tiles.length
  const effOut = Math.min(Math.max(2, Math.floor(outCount) || 0), Math.max(2, poolSize))
  const effLead = Math.min(Math.max(0, Math.floor(leadCount) || 0), effOut, poolSize)
  const randomFill = Math.max(0, effOut - effLead)
  const nVariants = Math.max(1, Math.floor(variants) || 1)
  const noRandomLeft = randomFill === 0 && nVariants > 1
  const plannedVariants = randomFill === 0 ? 1 : nVariants

  // Đổi kho / thiết lập → bản trộn cũ không còn đúng, buộc trộn lại.
  const sig = tiles.map((t) => t.path).join('|') + `#${leadCount}#${outCount}#${variants}`
  useEffect(() => {
    setJobs(null)
  }, [sig])

  // Kẹp lại số liệu khi kho thay đổi.
  useEffect(() => {
    setOutCount((o) => Math.min(Math.max(2, o), Math.max(2, poolSize)))
    setLeadCount((l) => Math.min(Math.max(0, l), poolSize))
  }, [poolSize])

  useEffect(() => {
    setLeadCount((l) => Math.min(l, effOut))
  }, [effOut])

  const buildJobs = (): string[][] => {
    const paths = tiles.map((t) => t.path)
    const leaders = paths.slice(0, effLead)
    const rest = paths.slice(effLead)
    const out: string[][] = []
    const seen = new Set<string>()
    for (let v = 0; v < nVariants; v++) {
      let unique = false
      let job: string[] = []
      for (let attempt = 0; attempt < 20; attempt++) {
        const picked = shuffle(rest).slice(0, randomFill)
        job = [...leaders, ...picked]
        if (!seen.has(job.join('|'))) {
          unique = true
          break
        }
      }
      if (!unique) break
      seen.add(job.join('|'))
      out.push(job)
    }
    return out
  }

  const tileByPath = useMemo(() => {
    const m = new Map<string, Tile>()
    for (const t of tiles) m.set(t.path, t)
    return m
  }, [tiles])

  const canRun = poolSize >= 2 && effOut >= 2 && !busy

  const doShuffle = (): void => {
    if (!canRun) return
    setJobs(buildJobs())
  }

  const doGenerate = async (): Promise<void> => {
    if (!canRun) return
    const jb = jobs ?? buildJobs()
    if (jb.some((j) => j.length < 2)) {
      pushToast('error', t('Mỗi bản ghép cần ít nhất 2 file', 'Each merge needs at least 2 files'))
      return
    }
    setBusy(true)
    try {
      setJobs(jb)
      const payload: RandomAudioStartPayload = { jobs: jb, forceReencode, format, outputDir }
      const ids = await invoke<string[]>('mod:random-audio:start', payload)
      pushToast(
        'success',
        t(`Đã tạo ${ids.length} bản ghép vào hàng đợi`, `Queued ${ids.length} merge(s)`)
      )
    } finally {
      setBusy(false)
    }
  }

  const fmtAudioSub = (info: MediaInfo | null): React.JSX.Element => (
    <div className="rna-sub">
      <span className="mono">{info ? secToHms(info.durationSec) : '…'}</span>
      {info?.audio && <span className="mono">{info.audio.codec.toUpperCase()}</span>}
      {info?.audio?.sampleRate ? (
        <span className="mono">{Math.round(info.audio.sampleRate / 100) / 10} kHz</span>
      ) : null}
      {info?.audio?.channels ? (
        <span className="mono">{info.audio.channels === 1 ? 'mono' : info.audio.channels === 2 ? 'stereo' : `${info.audio.channels}ch`}</span>
      ) : null}
      {info && <span>{fmtBytes(info.sizeBytes)}</span>}
    </div>
  )

  const totalDur = tiles.reduce((s, t) => s + (t.info?.durationSec ?? 0), 0)

  return (
    <div>
      <div className="page-title">{t('Ghép Âm Thanh Ngẫu Nhiên', 'Random Audio Merge')}</div>
      <div className="page-desc">
        {t(
          'Nạp cả thư mục âm thanh, kéo-thả để sắp thứ tự các file đầu (giữ nguyên), phần còn lại của bản ghép được chọn ngẫu nhiên không trùng lặp. Có thể xuất nhiều bản khác nhau cùng lúc.',
          'Load a whole folder of audio, drag to arrange the leading files (kept fixed); the rest of each merge is picked randomly with no duplicates. Export several different variants at once.'
        )}
      </div>

      {/* ---- Kho âm thanh ---- */}
      <div className="card">
        <div className="card-title">
          {t('Kho âm thanh', 'Audio pool')}
          {poolSize > 0 && (
            <span className="right text-dim" style={{ fontSize: 12 }}>
              {poolSize} {t('file', 'files')} · {secToHms(totalDur)}
              <button className="btn btn-sm btn-ghost" style={{ marginLeft: 8 }} onClick={clearAll}>
                {t('Xoá tất cả', 'Clear all')}
              </button>
            </span>
          )}
        </div>

        {poolSize > 0 && (
          <>
            <div className="rna-hint mb">
              {t(
                'Kéo-thả để đổi thứ tự · số file đầu (🔒) giữ nguyên thứ tự này, các tile còn lại (🎲) là kho chọn ngẫu nhiên.',
                'Drag to reorder · the leading files (🔒) keep this exact order, the remaining tiles (🎲) are the random pool.'
              )}
            </div>
            <div className="rna-grid mb">
              {tiles.map((it, idx) => {
                const lead = idx < effLead
                return (
                  <div
                    key={it.path}
                    className={
                      'rna-tile' +
                      (lead ? ' lead' : '') +
                      (dragOver === idx ? ' dragover' : '') +
                      (dragFrom.current === idx ? ' dragging' : '')
                    }
                    draggable
                    onDragStart={() => {
                      dragFrom.current = idx
                    }}
                    onDragOver={(e) => {
                      e.preventDefault()
                      if (dragOver !== idx) setDragOver(idx)
                    }}
                    onDragLeave={() => setDragOver((cur) => (cur === idx ? null : cur))}
                    onDrop={() => dropReorder(idx)}
                    onDragEnd={() => {
                      dragFrom.current = null
                      setDragOver(null)
                    }}
                    title={it.path}
                  >
                    <div className="rna-wave-wrap">
                      {it.wave ? (
                        <img src={it.wave} alt="" draggable={false} />
                      ) : (
                        <span className="rna-wave-ph">{it.waveLoading ? <span className="spin" /> : '🎵'}</span>
                      )}
                      <span className={'rna-order ' + (lead ? 'lead' : 'rand')}>
                        {lead ? `🔒 ${idx + 1}` : '🎲'}
                      </span>
                      <div
                        className="rna-tile-actions"
                        draggable={false}
                        onDragStart={(e) => e.stopPropagation()}
                      >
                        <button
                          className="btn btn-sm btn-icon"
                          disabled={idx === 0}
                          title={t('Lên', 'Up')}
                          onClick={() => move(idx, -1)}
                        >
                          ↑
                        </button>
                        <button
                          className="btn btn-sm btn-icon"
                          disabled={idx === poolSize - 1}
                          title={t('Xuống', 'Down')}
                          onClick={() => move(idx, 1)}
                        >
                          ↓
                        </button>
                        <button
                          className="btn btn-sm btn-icon btn-danger"
                          title={t('Xoá', 'Remove')}
                          onClick={() => removeAt(idx)}
                        >
                          🗑
                        </button>
                      </div>
                    </div>
                    <div className="rna-meta">
                      <div className="rna-name ellipsis">{baseName(it.path)}</div>
                      {fmtAudioSub(it.info)}
                    </div>
                  </div>
                )
              })}
            </div>
          </>
        )}

        <div
          className={`dropzone${dropOver ? ' over' : ''}`}
          onDragOver={(e) => {
            e.preventDefault()
            setDropOver(true)
          }}
          onDragLeave={() => setDropOver(false)}
          onDrop={(e) => void handleDrop(e)}
          onClick={() => void browseFiles()}
        >
          <div className="big">🎧</div>
          <div>
            {t(
              'Kéo-thả file âm thanh hoặc cả thư mục vào đây, hoặc bấm để chọn file',
              'Drag & drop audio files or a whole folder here, or click to browse'
            )}
          </div>
          <div className="mt">
            <button
              className="btn btn-sm"
              onClick={(e) => {
                e.stopPropagation()
                void browseFolder()
              }}
            >
              {t('Chọn thư mục', 'Choose folder')}
            </button>
          </div>
        </div>
      </div>

      {/* ---- Thiết lập ngẫu nhiên ---- */}
      <div className="card">
        <div className="card-title">{t('Thiết lập ngẫu nhiên', 'Randomize settings')}</div>
        <div className="grid-3">
          <Field
            label={t('Số file trong bản ghép', 'Files per merge')}
            hint={t(`Tối đa ${Math.max(2, poolSize)} (số file trong kho)`, `Max ${Math.max(2, poolSize)} (pool size)`)}
          >
            <NumInput value={outCount} onChange={setOutCount} min={2} max={Math.max(2, poolSize)} step={1} />
          </Field>
          <Field
            label={t('Số file đầu giữ thứ tự', 'Leading files (fixed order)')}
            hint={t('0 = ghép hoàn toàn ngẫu nhiên', '0 = fully random')}
          >
            <NumInput value={leadCount} onChange={setLeadCount} min={0} max={Math.min(effOut, poolSize)} step={1} />
          </Field>
          <Field
            label={t('Số bản xuất', 'Number of variants')}
            hint={t('Mỗi bản là một tổ hợp ngẫu nhiên khác nhau', 'Each is a different random combination')}
          >
            <NumInput value={variants} onChange={setVariants} min={1} max={500} step={1} />
          </Field>
        </div>

        <Field
          label={t('Thư mục xuất', 'Output folder')}
          hint={t(
            'Để trống sẽ lưu cạnh file đầu tiên của mỗi bản. Lựa chọn này được ghi nhớ.',
            'Leave empty to save next to the first file of each merge. This choice is remembered.'
          )}
        >
          <FolderInput
            value={outputDir}
            onChange={changeOutputDir}
            placeholder={t('Cạnh file âm thanh nguồn', 'Next to the source audio')}
          />
        </Field>

        <div className="row mt wrap">
          <Check
            checked={forceReencode}
            onChange={setForceReencode}
            label={t('Luôn chuẩn hoá (re-encode)', 'Always normalize (re-encode)')}
          />
          <Field label={t('Định dạng đầu ra', 'Output format')}>
            <Select<RandomAudioFormat>
              value={format}
              onChange={setFormat}
              options={[
                { value: 'mp3', label: t('MP3 (.mp3) — mặc định', 'MP3 (.mp3) — default') },
                { value: 'wav', label: t('WAV (.wav) — không nén', 'WAV (.wav) — uncompressed') }
              ]}
            />
          </Field>
          <span className="hint">
            {t(
              'Tắt chuẩn hoá: nguồn đã đúng định dạng chọn → ghép copy; còn lại tự re-encode.',
              'Normalization off: sources already in the selected format are copied; others are re-encoded.'
            )}
          </span>
        </div>

        <div className="row mt">
          <button className="btn" disabled={!canRun} onClick={doShuffle}>
            🎲 {t('Trộn ngẫu nhiên', 'Shuffle')}
          </button>
          <button className="btn btn-primary" disabled={!canRun} onClick={() => void doGenerate()}>
            🚀{' '}
            {plannedVariants > 1
              ? t(`Tạo ${plannedVariants} bản ghép`, `Create ${plannedVariants} merges`)
              : t('Tạo bản ghép', 'Create merge')}
          </button>
          <span className={noRandomLeft ? 'hint text-danger' : 'hint'}>
            {poolSize < 2
              ? t('Cần ít nhất 2 file trong kho', 'Need at least 2 files in the pool')
              : noRandomLeft
                ? t(
                    'Số file đầu = số file/bản → không còn phần ngẫu nhiên, chỉ tạo 1 bản duy nhất.',
                    'Leading = files/merge → no random part left, only 1 unique merge will be made.'
                  )
                : t(
                    `${effLead} file đầu (giữ thứ tự) + ${randomFill} file ngẫu nhiên = ${effOut} file/bản`,
                    `${effLead} leading (fixed) + ${randomFill} random = ${effOut} files/merge`
                  )}
          </span>
        </div>

        {jobs && jobs.length > 0 && (
          <div className="rna-preview mt">
            <div className="rna-preview-head">
              {t('Xem trước bản 1', 'Preview #1')} / {jobs.length}
              {jobs.length > 1 && (
                <span className="text-dim">
                  {' '}
                  · {t(`+ ${jobs.length - 1} bản khác`, `+ ${jobs.length - 1} more`)}
                </span>
              )}
            </div>
            <div className="rna-strip">
              {jobs[0].map((p, i) => {
                const tile = tileByPath.get(p)
                const lead = i < effLead
                return (
                  <div className="rna-strip-item" key={`${i}-${p}`} title={p}>
                    <div className="rna-strip-wave">
                      {tile?.wave ? <img src={tile.wave} alt="" /> : <span className="rna-wave-ph">🎵</span>}
                      <span className={'rna-strip-badge ' + (lead ? 'lead' : 'rand')}>
                        {lead ? `🔒${i + 1}` : '🎲'}
                      </span>
                    </div>
                    <div className="rna-strip-name ellipsis">{baseName(p)}</div>
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </div>

      <TaskTable types={['random-audio']} />
    </div>
  )
}
