import { useEffect, useMemo, useRef, useState } from 'react'
import type { MediaInfo } from '@shared/types'
import type { RandomStartPayload } from '@shared/modules/random'
import { fmtBytes, secToHms } from '@shared/time'
import { invoke, invokeSilent, probe } from '../../api'
import { Check, Field, NumInput } from '../../components/Field'
import { FileDrop } from '../../components/FileDrop'
import { TaskTable } from '../../components/TaskTable'
import { useT } from '../../i18n'
import { useSettings } from '../../store/settings'
import { useUi } from '../../store/ui'
import './styles.css'

interface Tile {
  path: string
  /** null = đang probe hoặc probe lỗi */
  info: MediaInfo | null
  /** data URI ảnh xem trước; null = chưa có / lỗi */
  thumb: string | null
  thumbLoading: boolean
}

const baseName = (p: string): string => p.split(/[\\/]/).pop() ?? p

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
 * Module Ghép Video Ngẫu Nhiên:
 * - Kéo-thả / chọn thư mục video → kho tile (thumbnail + thông tin).
 * - Kéo-thả tile để đổi thứ tự; N video đầu (🔒) giữ nguyên thứ tự đó.
 * - Chọn số video trong bản ghép + số bản xuất → phần còn lại chọn NGẪU NHIÊN, KHÔNG trùng.
 */
export default function Random(): React.JSX.Element {
  const t = useT()
  const pushToast = useUi((s) => s.pushToast)
  const outputDir = useSettings((s) => s.settings?.outputDir ?? '')

  const [tiles, setTiles] = useState<Tile[]>([])
  const [leadCount, setLeadCount] = useState(1)
  const [outCount, setOutCount] = useState(3)
  const [variants, setVariants] = useState(1)
  const [forceReencode, setForceReencode] = useState(false)
  const [jobs, setJobs] = useState<string[][] | null>(null)
  const [busy, setBusy] = useState(false)

  const [dragOver, setDragOver] = useState<number | null>(null)
  const dragFrom = useRef<number | null>(null)

  // Ref đọc tiles hiện tại trong event handler (dedupe khi thêm file) không cần re-bind.
  const tilesRef = useRef(tiles)
  tilesRef.current = tiles

  // Limiter bền vững theo vòng đời component.
  const probeLimitRef = useRef<((fn: () => Promise<void>) => void) | null>(null)
  const thumbLimitRef = useRef<((fn: () => Promise<void>) => void) | null>(null)
  if (!probeLimitRef.current) probeLimitRef.current = makeLimiter(6)
  if (!thumbLimitRef.current) thumbLimitRef.current = makeLimiter(3)

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
    thumbLimitRef.current!(async () => {
      try {
        const url = await invokeSilent<string>('mod:random:thumb', { path: p })
        patchTile(p, { thumb: url, thumbLoading: false })
      } catch {
        patchTile(p, { thumbLoading: false })
      }
    })
  }

  const addFiles = (paths: string[]): void => {
    const have = new Set(tilesRef.current.map((t) => t.path))
    const fresh = paths.filter((p, idx, arr) => !have.has(p) && arr.indexOf(p) === idx)
    if (!fresh.length) return
    setTiles((prev) => [
      ...prev,
      ...fresh.map((p): Tile => ({ path: p, info: null, thumb: null, thumbLoading: true }))
    ])
    for (const p of fresh) loadOne(p)
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
  // Không còn video ngẫu nhiên (randomFill=0) → chỉ có đúng 1 tổ hợp, mọi bản sẽ giống hệt nhau.
  const noRandomLeft = randomFill === 0 && nVariants > 1
  const plannedVariants = randomFill === 0 ? 1 : nVariants

  // Đổi kho / thiết lập → bản trộn cũ không còn đúng, buộc trộn lại.
  const sig = tiles.map((t) => t.path).join('|') + `#${leadCount}#${outCount}#${variants}`
  useEffect(() => {
    setJobs(null)
  }, [sig])

  // Kẹp lại số liệu khi kho video thay đổi.
  useEffect(() => {
    setOutCount((o) => Math.min(Math.max(2, o), Math.max(2, poolSize)))
    setLeadCount((l) => Math.min(Math.max(0, l), poolSize))
  }, [poolSize])

  // Số video đầu không được vượt số video/bản → kẹp khi giảm "Số video trong bản ghép".
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
      // Thử tối đa 20 lần để tìm một tổ hợp CHƯA gặp; nếu không còn tổ hợp mới
      // (vd randomFill=0 hoặc kho quá nhỏ) thì dừng — không tạo bản trùng lặp.
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
      if (!unique) break // đã hết tổ hợp khác nhau
      seen.add(job.join('|'))
      out.push(job)
    }
    return out
  }

  const thumbByPath = useMemo(() => {
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
      pushToast('error', t('Mỗi bản ghép cần ít nhất 2 video', 'Each merge needs at least 2 videos'))
      return
    }
    setBusy(true)
    try {
      setJobs(jb)
      const payload: RandomStartPayload = { jobs: jb, forceReencode, outputDir }
      const ids = await invoke<string[]>('mod:random:start', payload)
      pushToast(
        'success',
        t(`Đã tạo ${ids.length} bản ghép vào hàng đợi`, `Queued ${ids.length} merge(s)`)
      )
    } finally {
      setBusy(false)
    }
  }

  const totalDur = tiles.reduce((s, t) => s + (t.info?.durationSec ?? 0), 0)

  return (
    <div>
      <div className="page-title">{t('Ghép Video Ngẫu Nhiên', 'Random Merge')}</div>
      <div className="page-desc">
        {t(
          'Nạp cả thư mục video, kéo-thả để sắp thứ tự các video đầu (giữ nguyên), phần còn lại của bản ghép được chọn ngẫu nhiên không trùng lặp. Có thể xuất nhiều bản khác nhau cùng lúc.',
          'Load a whole folder of videos, drag to arrange the leading videos (kept fixed); the rest of each merge is picked randomly with no duplicates. Export several different variants at once.'
        )}
      </div>

      {/* ---- Kho video ---- */}
      <div className="card">
        <div className="card-title">
          {t('Kho video', 'Video pool')}
          {poolSize > 0 && (
            <span className="right text-dim" style={{ fontSize: 12 }}>
              {poolSize} {t('video', 'videos')} · {secToHms(totalDur)}
              <button className="btn btn-sm btn-ghost" style={{ marginLeft: 8 }} onClick={clearAll}>
                {t('Xoá tất cả', 'Clear all')}
              </button>
            </span>
          )}
        </div>

        {poolSize > 0 && (
          <>
            <div className="rnd-hint mb">
              {t(
                'Kéo-thả để đổi thứ tự · số video đầu (🔒) giữ nguyên thứ tự này, các tile còn lại (🎲) là kho chọn ngẫu nhiên.',
                'Drag to reorder · the leading videos (🔒) keep this exact order, the remaining tiles (🎲) are the random pool.'
              )}
            </div>
            <div className="rnd-grid mb">
              {tiles.map((it, idx) => {
                const lead = idx < effLead
                return (
                  <div
                    key={it.path}
                    className={
                      'rnd-tile' +
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
                    <div className="rnd-thumb-wrap">
                      {it.thumb ? (
                        <img src={it.thumb} alt="" draggable={false} />
                      ) : (
                        <span className="rnd-thumb-ph">{it.thumbLoading ? <span className="spin" /> : '🎬'}</span>
                      )}
                      <span className={'rnd-order ' + (lead ? 'lead' : 'rand')}>
                        {lead ? `🔒 ${idx + 1}` : '🎲'}
                      </span>
                      <div
                        className="rnd-tile-actions"
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
                    <div className="rnd-meta">
                      <div className="rnd-name ellipsis">{baseName(it.path)}</div>
                      <div className="rnd-sub">
                        <span className="mono">{it.info ? secToHms(it.info.durationSec) : '…'}</span>
                        {it.info?.video && (
                          <span className="mono">
                            {it.info.video.width}×{it.info.video.height}
                          </span>
                        )}
                        {it.info?.video && <span className="mono">{it.info.video.codec.toUpperCase()}</span>}
                        {it.info && <span>{fmtBytes(it.info.sizeBytes)}</span>}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </>
        )}

        <FileDrop
          multi
          onFiles={addFiles}
          hint={t(
            'Kéo-thả video hoặc cả thư mục vào đây, hoặc bấm để chọn',
            'Drag & drop videos or a whole folder here, or click to browse'
          )}
        />
      </div>

      {/* ---- Thiết lập ngẫu nhiên ---- */}
      <div className="card">
        <div className="card-title">{t('Thiết lập ngẫu nhiên', 'Randomize settings')}</div>
        <div className="grid-3">
          <Field
            label={t('Số video trong bản ghép', 'Videos per merge')}
            hint={t(`Tối đa ${Math.max(2, poolSize)} (số video trong kho)`, `Max ${Math.max(2, poolSize)} (pool size)`)}
          >
            <NumInput value={outCount} onChange={setOutCount} min={2} max={Math.max(2, poolSize)} step={1} />
          </Field>
          <Field
            label={t('Số video đầu giữ thứ tự', 'Leading videos (fixed order)')}
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

        <div className="row mt">
          <Check
            checked={forceReencode}
            onChange={setForceReencode}
            label={t('Luôn chuẩn hoá (re-encode)', 'Always normalize (re-encode)')}
          />
          <span className="hint">
            {t(
              'Bỏ trống: cùng chuẩn → ghép copy tức thì, khác chuẩn → tự re-encode.',
              'Off: same format → instant copy merge, mixed → auto re-encode.'
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
              ? t('Cần ít nhất 2 video trong kho', 'Need at least 2 videos in the pool')
              : noRandomLeft
                ? t(
                    'Số video đầu = số video/bản → không còn phần ngẫu nhiên, chỉ tạo 1 bản duy nhất.',
                    'Leading = videos/merge → no random part left, only 1 unique merge will be made.'
                  )
                : t(
                    `${effLead} video đầu (giữ thứ tự) + ${randomFill} video ngẫu nhiên = ${effOut} video/bản`,
                    `${effLead} leading (fixed) + ${randomFill} random = ${effOut} videos/merge`
                  )}
          </span>
        </div>

        {jobs && jobs.length > 0 && (
          <div className="rnd-preview mt">
            <div className="rnd-preview-head">
              {t('Xem trước bản 1', 'Preview #1')} / {jobs.length}
              {jobs.length > 1 && (
                <span className="text-dim">
                  {' '}
                  · {t(`+ ${jobs.length - 1} bản khác`, `+ ${jobs.length - 1} more`)}
                </span>
              )}
            </div>
            <div className="rnd-strip">
              {jobs[0].map((p, i) => {
                const tile = thumbByPath.get(p)
                const lead = i < effLead
                return (
                  <div className="rnd-strip-item" key={`${i}-${p}`} title={p}>
                    <div className="rnd-strip-thumb">
                      {tile?.thumb ? <img src={tile.thumb} alt="" /> : <span className="rnd-thumb-ph">🎬</span>}
                      <span className={'rnd-strip-badge ' + (lead ? 'lead' : 'rand')}>
                        {lead ? `🔒${i + 1}` : '🎲'}
                      </span>
                    </div>
                    <div className="rnd-strip-name ellipsis">{baseName(p)}</div>
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </div>

      <TaskTable types={['random']} />
    </div>
  )
}
