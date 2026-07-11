import { useEffect, useMemo, useRef, useState } from 'react'
import { create } from 'zustand'
import type { MediaInfo } from '@shared/types'
import type { RandomAudioFormat, RandomAudioStartPayload } from '@shared/modules/random-audio'
import { fmtBytes, secToHms } from '@shared/time'
import { cleanError, invokeSilent, kvGet, kvSet, pathForFile, pickFiles, pickFolder, probe, statPath } from '../../api'
import { Check, Field, FolderInput, NumInput, Select } from '../../components/Field'
import { MergeDraftQueue, type MergeDraftBase } from '../../components/MergeDraftQueue'
import { TaskTable } from '../../components/TaskTable'
import { ViewToggle, type MediaViewMode } from '../../components/ViewToggle'
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

interface RandomAudioDraft extends MergeDraftBase {
  createdAt: number
  forceReencode: boolean
  outputDir: string
  format: RandomAudioFormat
  leadCount: number
}

const baseName = (p: string): string => p.split(/[\\/]/).pop() ?? p

const AUDIO_EXTS = ['mp3', 'm4a', 'aac', 'wav', 'flac', 'ogg', 'oga', 'opus', 'wma', 'aiff', 'aif', 'ac3', 'mka']
const AUDIO_FILTERS = [
  { name: 'Âm thanh', extensions: AUDIO_EXTS },
  { name: 'Tất cả file', extensions: ['*'] }
]
const AUDIO_KV_NAMESPACE = 'random-audio'
const AUDIO_DRAFTS_KEY = 'drafts-v1'
const AUDIO_EXT_RE = new RegExp(`\\.(${AUDIO_EXTS.join('|')})$`, 'i')

function isRandomAudioDraft(value: unknown): value is RandomAudioDraft {
  if (!value || typeof value !== 'object') return false
  const draft = value as Record<string, unknown>
  return (
    typeof draft.id === 'string' &&
    draft.id.length > 0 &&
    Array.isArray(draft.inputs) &&
    draft.inputs.length >= 2 &&
    draft.inputs.every((input) => typeof input === 'string' && input.length > 0) &&
    typeof draft.createdAt === 'number' &&
    Number.isFinite(draft.createdAt) &&
    typeof draft.forceReencode === 'boolean' &&
    typeof draft.outputDir === 'string' &&
    (draft.format === 'mp3' || draft.format === 'wav') &&
    typeof draft.leadCount === 'number' &&
    Number.isInteger(draft.leadCount) &&
    draft.leadCount >= 0
  )
}

function parseRandomAudioDrafts(value: unknown): RandomAudioDraft[] {
  if (!Array.isArray(value)) return []
  const seenIds = new Set<string>()
  return value.filter((draft): draft is RandomAudioDraft => {
    if (!isRandomAudioDraft(draft) || seenIds.has(draft.id)) return false
    seenIds.add(draft.id)
    return true
  })
}

interface RandomAudioDraftQueueState {
  drafts: RandomAudioDraft[]
  hydrated: boolean
  hydrate(drafts: RandomAudioDraft[]): void
  commit(update: (current: RandomAudioDraft[]) => RandomAudioDraft[]): void
}

const useRandomAudioDraftQueue = create<RandomAudioDraftQueueState>((set, get) => ({
  drafts: [],
  hydrated: false,
  hydrate: (drafts) => set({ drafts, hydrated: true }),
  commit: (update) => {
    const next = update(get().drafts)
    set({ drafts: next })
    void kvSet(AUDIO_KV_NAMESPACE, AUDIO_DRAFTS_KEY, next).catch(() => undefined)
  }
}))

let randomAudioDraftLoadPromise: Promise<void> | null = null

function ensureRandomAudioDraftsLoaded(): void {
  if (useRandomAudioDraftQueue.getState().hydrated || randomAudioDraftLoadPromise) return
  randomAudioDraftLoadPromise = (async () => {
    let lastError: unknown
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const saved = await invokeSilent<unknown>('core:kv:get', {
          ns: AUDIO_KV_NAMESPACE,
          key: AUDIO_DRAFTS_KEY,
          def: []
        })
        useRandomAudioDraftQueue.getState().hydrate(parseRandomAudioDrafts(saved))
        return
      } catch (error) {
        lastError = error
        if (attempt < 2) {
          await new Promise<void>((resolve) => setTimeout(resolve, 350 * (attempt + 1)))
        }
      }
    }
    throw lastError
  })()
    .catch(() => {
      const english = useSettings.getState().settings?.language === 'en'
      useUi.getState().pushToast(
        'error',
        english
          ? 'Could not load the audio queue. Existing data was not overwritten.'
          : 'Không thể tải hàng đợi âm thanh. Tools chưa ghi đè dữ liệu cũ.'
      )
    })
    .finally(() => {
      randomAudioDraftLoadPromise = null
    })
}

function draftId(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID()
  return `random-audio-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

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
  const [previewJobs, setPreviewJobs] = useState<string[][] | null>(null)
  const drafts = useRandomAudioDraftQueue((state) => state.drafts)
  const draftsHydrated = useRandomAudioDraftQueue((state) => state.hydrated)
  const commitDrafts = useRandomAudioDraftQueue((state) => state.commit)
  const [submittingIds, setSubmittingIds] = useState<ReadonlySet<string>>(new Set())
  const [viewMode, setViewMode] = useState<MediaViewMode>('grid')
  const [dropOver, setDropOver] = useState(false)

  const [dragOver, setDragOver] = useState<number | null>(null)
  const dragFrom = useRef<number | null>(null)
  const submittingRef = useRef(new Set<string>())
  const viewModeEditedRef = useRef(false)
  const outputDirEditedRef = useRef(false)

  useEffect(() => {
    let alive = true
    void kvGet<string>('random-audio', 'outputDir', defaultOutputDir)
      .then((saved) => {
        if (alive && !outputDirEditedRef.current) setOutputDir(saved)
      })
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [defaultOutputDir])

  useEffect(() => {
    ensureRandomAudioDraftsLoaded()
  }, [])

  useEffect(() => {
    let alive = true
    void invokeSilent<unknown>('core:kv:get', {
      ns: 'random-audio',
      key: 'view-mode',
      def: 'grid'
    })
      .then((savedView) => {
        if (alive && !viewModeEditedRef.current) setViewMode(savedView === 'list' ? 'list' : 'grid')
      })
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [])

  const changeOutputDir = (value: string): void => {
    outputDirEditedRef.current = true
    setOutputDir(value)
    void kvSet('random-audio', 'outputDir', value).catch(() => undefined)
  }

  const changeViewMode = (value: MediaViewMode): void => {
    viewModeEditedRef.current = true
    setViewMode(value)
    void kvSet('random-audio', 'view-mode', value).catch(() => undefined)
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
    setPreviewJobs(null)
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

  const canShuffle = poolSize >= 2 && effOut >= 2
  const canCreate = draftsHydrated && canShuffle

  const doShuffle = (): void => {
    if (!canShuffle) return
    setPreviewJobs(buildJobs())
  }

  const createDrafts = (): void => {
    if (!canCreate) return
    const jb = previewJobs ?? buildJobs()
    if (jb.some((j) => j.length < 2)) {
      pushToast('error', t('Mỗi bản ghép cần ít nhất 2 file', 'Each merge needs at least 2 files'))
      return
    }
    if (jb.length === 0) {
      pushToast('error', t('Không thể tạo thêm tổ hợp âm thanh duy nhất', 'No unique audio combination is available'))
      return
    }
    const createdAt = Date.now()
    const nextDrafts = jb.map(
      (inputs, index): RandomAudioDraft => ({
        id: draftId(),
        inputs: [...inputs],
        createdAt: createdAt + index,
        forceReencode,
        outputDir,
        format,
        leadCount: effLead
      })
    )
    commitDrafts((prev) => [...prev, ...nextDrafts])
    setPreviewJobs(null)
    pushToast(
      'success',
      t(
        `Đã thêm ${nextDrafts.length} bản ghép vào hàng đợi (chưa chạy)`,
        `Added ${nextDrafts.length} merge(s) to the queue (not started)`
      )
    )
  }

  const claimDrafts = (items: RandomAudioDraft[]): RandomAudioDraft[] => {
    const claimed = items.filter((draft) => !submittingRef.current.has(draft.id))
    if (!claimed.length) return []
    for (const draft of claimed) submittingRef.current.add(draft.id)
    setSubmittingIds(new Set(submittingRef.current))
    return claimed
  }

  const releaseDrafts = (items: RandomAudioDraft[]): void => {
    for (const draft of items) submittingRef.current.delete(draft.id)
    setSubmittingIds(new Set(submittingRef.current))
  }

  const enqueueDraft = async (draft: RandomAudioDraft): Promise<void> => {
    const payload: RandomAudioStartPayload = {
      jobs: [[...draft.inputs]],
      forceReencode: draft.forceReencode,
      format: draft.format,
      outputDir: draft.outputDir,
      draftId: draft.id
    }
    await invokeSilent<string[]>('mod:random-audio:start', payload)
  }

  const runDraft = async (draft: RandomAudioDraft): Promise<void> => {
    const [claimed] = claimDrafts([draft])
    if (!claimed) return
    try {
      await enqueueDraft(claimed)
      commitDrafts((prev) => prev.filter((item) => item.id !== claimed.id))
      pushToast('success', t('Đã chuyển tác vụ sang hàng đợi xử lý', 'Task sent to the processing queue'))
    } catch (error) {
      pushToast('error', cleanError(error))
    } finally {
      releaseDrafts([claimed])
    }
  }

  const runAllDrafts = async (): Promise<void> => {
    const claimed = claimDrafts(useRandomAudioDraftQueue.getState().drafts)
    if (!claimed.length) return

    let cursor = 0
    const succeeded: string[] = []
    const failures: string[] = []
    const worker = async (): Promise<void> => {
      while (cursor < claimed.length) {
        const draft = claimed[cursor++]
        try {
          await enqueueDraft(draft)
          succeeded.push(draft.id)
        } catch (error) {
          failures.push(cleanError(error))
        }
      }
    }

    try {
      await Promise.all(Array.from({ length: Math.min(3, claimed.length) }, () => worker()))
      if (succeeded.length) {
        const completed = new Set(succeeded)
        commitDrafts((prev) => prev.filter((draft) => !completed.has(draft.id)))
        pushToast(
          'success',
          t(
            `Đã chuyển ${succeeded.length} tác vụ sang hàng đợi xử lý`,
            `Sent ${succeeded.length} task(s) to the processing queue`
          )
        )
      }
      if (failures.length) {
        const firstError = failures[0]
        pushToast(
          'error',
          t(
            `${failures.length} tác vụ chưa thể chạy: ${firstError}`,
            `${failures.length} task(s) could not start: ${firstError}`
          )
        )
      }
    } finally {
      releaseDrafts(claimed)
    }
  }

  const removeDraft = (draft: RandomAudioDraft): void => {
    if (submittingRef.current.has(draft.id)) return
    commitDrafts((prev) => prev.filter((item) => item.id !== draft.id))
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
          <span>{t('Kho âm thanh', 'Audio pool')}</span>
          <span className="right rna-pool-tools">
            {poolSize > 0 && (
              <span className="text-dim rna-pool-summary">
                {poolSize} {t('file', 'files')} · {secToHms(totalDur)}
                <button
                  type="button"
                  className="btn btn-sm btn-ghost"
                  onClick={clearAll}
                >
                  {t('Xoá tất cả', 'Clear all')}
                </button>
              </span>
            )}
            <ViewToggle value={viewMode} onChange={changeViewMode} />
          </span>
        </div>

        {poolSize > 0 && (
          <>
            <div className="rna-hint mb">
              {t(
                'Kéo-thả để đổi thứ tự · số file đầu (🔒) giữ nguyên thứ tự này, các tile còn lại (🎲) là kho chọn ngẫu nhiên.',
                'Drag to reorder · the leading files (🔒) keep this exact order, the remaining tiles (🎲) are the random pool.'
              )}
            </div>
            <div
              className={`rna-grid mb${viewMode === 'list' ? ' list-view' : ''}`}
              role="list"
              aria-label={t('Danh sách kho âm thanh', 'Audio library items')}
            >
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
                    role="listitem"
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
                          type="button"
                          className="btn btn-sm btn-icon"
                          disabled={idx === 0}
                          title={t('Lên', 'Up')}
                          aria-label={t(`Đưa ${baseName(it.path)} lên`, `Move ${baseName(it.path)} up`)}
                          onClick={() => move(idx, -1)}
                        >
                          ↑
                        </button>
                        <button
                          type="button"
                          className="btn btn-sm btn-icon"
                          disabled={idx === poolSize - 1}
                          title={t('Xuống', 'Down')}
                          aria-label={t(`Đưa ${baseName(it.path)} xuống`, `Move ${baseName(it.path)} down`)}
                          onClick={() => move(idx, 1)}
                        >
                          ↓
                        </button>
                        <button
                          type="button"
                          className="btn btn-sm btn-icon btn-danger"
                          title={t('Xoá', 'Remove')}
                          aria-label={t(`Xoá ${baseName(it.path)}`, `Remove ${baseName(it.path)}`)}
                          onClick={() => removeAt(idx)}
                        >
                          🗑
                        </button>
                      </div>
                    </div>
                    <div className="rna-meta">
                      <div className="rna-name ellipsis">{baseName(it.path)}</div>
                      <div className="rna-path ellipsis">{it.path}</div>
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
              type="button"
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
          <button type="button" className="btn" disabled={!canShuffle} onClick={doShuffle}>
            🎲 {t('Trộn ngẫu nhiên', 'Shuffle')}
          </button>
          <button type="button" className="btn btn-primary" disabled={!canCreate} onClick={createDrafts}>
            ＋{' '}
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
          {canCreate && (
            <span className="hint">
              {t('Chỉ thêm vào hàng đợi, chưa bắt đầu xử lý.', 'Adds to the queue without starting it.')}
            </span>
          )}
        </div>

        {previewJobs && previewJobs.length > 0 && (
          <div className="rna-preview mt">
            <div className="rna-preview-head">
              {t('Xem trước bản 1', 'Preview #1')} / {previewJobs.length}
              {previewJobs.length > 1 && (
                <span className="text-dim">
                  {' '}
                  · {t(`+ ${previewJobs.length - 1} bản khác`, `+ ${previewJobs.length - 1} more`)}
                </span>
              )}
            </div>
            <div className="rna-strip">
              {previewJobs[0].map((p, i) => {
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

      <MergeDraftQueue
        drafts={drafts}
        submittingIds={submittingIds}
        mediaWord={['file âm thanh', 'audio file']}
        renderMedia={(path, index, draft) => {
          const tile = tileByPath.get(path)
          const lead = index < draft.leadCount
          return (
            <div className="rna-draft-wave">
              {tile?.wave ? (
                <img src={tile.wave} alt="" draggable={false} />
              ) : (
                <span className="rna-wave-ph">🎵</span>
              )}
              <span className={'rna-strip-badge ' + (lead ? 'lead' : 'rand')}>
                {lead ? `🔒${index + 1}` : '🎲'}
              </span>
            </div>
          )
        }}
        renderDetails={(draft) => (
          <div className="rna-draft-options">
            <span className="mono">{draft.format.toUpperCase()}</span>
            <span>
              {draft.forceReencode
                ? t('Chuẩn hoá', 'Normalize')
                : t('Tự chọn copy/re-encode', 'Auto copy/re-encode')}
            </span>
            <span className="ellipsis" title={draft.outputDir || undefined}>
              {draft.outputDir || t('Cạnh file nguồn', 'Next to source')}
            </span>
          </div>
        )}
        onRun={(draft) => void runDraft(draft)}
        onRemove={removeDraft}
        onRunAll={() => void runAllDrafts()}
        onClear={() => commitDrafts(() => [])}
      />

      <TaskTable types={['random-audio']} />
    </div>
  )
}
