import { useEffect, useMemo, useRef, useState } from 'react'
import { create } from 'zustand'
import type { MediaInfo } from '@shared/types'
import type { RandomStartPayload } from '@shared/modules/random'
import { fmtBytes, secToHms } from '@shared/time'
import { cleanError, invokeSilent, kvGet, kvSet, probe } from '../../api'
import { Check, Field, FolderInput, NumInput } from '../../components/Field'
import { FileDrop } from '../../components/FileDrop'
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
  /** data URI ảnh xem trước; null = chưa có / lỗi */
  thumb: string | null
  thumbLoading: boolean
}

interface RandomDraft extends MergeDraftBase {
  createdAt: number
  forceReencode: boolean
  outputDir: string
  leadCount: number
}

const KV_NAMESPACE = 'random'
const DRAFTS_KEY = 'drafts-v1'
const OUTPUT_DIR_KEY = 'outputDir'
const VIEW_MODE_KEY = 'view-mode'

function parseDrafts(value: unknown): RandomDraft[] {
  if (!Array.isArray(value)) return []

  const drafts: RandomDraft[] = []
  const seenIds = new Set<string>()
  for (const item of value) {
    if (!item || typeof item !== 'object') continue
    const candidate = item as Record<string, unknown>
    const inputs = candidate.inputs
    if (
      typeof candidate.id !== 'string' ||
      !candidate.id ||
      seenIds.has(candidate.id) ||
      !Array.isArray(inputs) ||
      inputs.length < 2 ||
      !inputs.every((path) => typeof path === 'string' && path.length > 0) ||
      typeof candidate.createdAt !== 'number' ||
      !Number.isFinite(candidate.createdAt) ||
      typeof candidate.forceReencode !== 'boolean' ||
      typeof candidate.outputDir !== 'string' ||
      typeof candidate.leadCount !== 'number' ||
      !Number.isFinite(candidate.leadCount)
    ) {
      continue
    }

    seenIds.add(candidate.id)
    drafts.push({
      id: candidate.id,
      inputs: [...inputs],
      createdAt: candidate.createdAt,
      forceReencode: candidate.forceReencode,
      outputDir: candidate.outputDir,
      leadCount: Math.min(inputs.length, Math.max(0, Math.floor(candidate.leadCount)))
    })
  }
  return drafts
}

interface RandomDraftQueueState {
  drafts: RandomDraft[]
  hydrated: boolean
  hydrate(drafts: RandomDraft[]): void
  commit(update: (current: RandomDraft[]) => RandomDraft[]): void
}

const useRandomDraftQueue = create<RandomDraftQueueState>((set, get) => ({
  drafts: [],
  hydrated: false,
  hydrate: (drafts) => set({ drafts, hydrated: true }),
  commit: (update) => {
    const next = update(get().drafts)
    set({ drafts: next })
    void kvSet(KV_NAMESPACE, DRAFTS_KEY, next).catch(() => undefined)
  }
}))

let randomDraftLoadPromise: Promise<void> | null = null

function ensureRandomDraftsLoaded(): void {
  if (useRandomDraftQueue.getState().hydrated || randomDraftLoadPromise) return
  randomDraftLoadPromise = (async () => {
    let lastError: unknown
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const saved = await invokeSilent<unknown>('core:kv:get', {
          ns: KV_NAMESPACE,
          key: DRAFTS_KEY,
          def: []
        })
        useRandomDraftQueue.getState().hydrate(parseDrafts(saved))
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
          ? 'Could not load the merge queue. Existing data was not overwritten.'
          : 'Không thể tải hàng đợi bản ghép. Tools chưa ghi đè dữ liệu cũ.'
      )
    })
    .finally(() => {
      randomDraftLoadPromise = null
    })
}

function createDraftId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `random-${Date.now()}-${Math.random().toString(36).slice(2)}`
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
  const defaultOutputDir = useSettings((s) => s.settings?.outputDir ?? '')

  const [tiles, setTiles] = useState<Tile[]>([])
  const [outputDir, setOutputDir] = useState(defaultOutputDir)
  const [leadCount, setLeadCount] = useState(1)
  const [outCount, setOutCount] = useState(3)
  const [variants, setVariants] = useState(1)
  const [forceReencode, setForceReencode] = useState(false)
  const [previewJobs, setPreviewJobs] = useState<string[][] | null>(null)
  const drafts = useRandomDraftQueue((state) => state.drafts)
  const draftsHydrated = useRandomDraftQueue((state) => state.hydrated)
  const commitDrafts = useRandomDraftQueue((state) => state.commit)
  const [viewMode, setViewMode] = useState<MediaViewMode>('grid')
  const [submittingIds, setSubmittingIds] = useState<Set<string>>(() => new Set())
  const submittingRef = useRef(new Set<string>())
  const outputDirEditedRef = useRef(false)
  const viewModeEditedRef = useRef(false)

  const [dragOver, setDragOver] = useState<number | null>(null)
  const dragFrom = useRef<number | null>(null)

  // Ref đọc tiles hiện tại trong event handler (dedupe khi thêm file) không cần re-bind.
  const tilesRef = useRef(tiles)
  tilesRef.current = tiles

  useEffect(() => {
    ensureRandomDraftsLoaded()
  }, [])

  useEffect(() => {
    let active = true
    void kvGet<string>(KV_NAMESPACE, OUTPUT_DIR_KEY, defaultOutputDir)
      .then((saved) => {
        if (active && !outputDirEditedRef.current) setOutputDir(saved)
      })
      .catch(() => undefined)
    return () => {
      active = false
    }
  }, [defaultOutputDir])

  useEffect(() => {
    let active = true
    void kvGet<unknown>(KV_NAMESPACE, VIEW_MODE_KEY, 'grid')
      .then((saved) => {
        if (active && !viewModeEditedRef.current && (saved === 'grid' || saved === 'list')) {
          setViewMode(saved)
        }
      })
      .catch(() => undefined)
    return () => {
      active = false
    }
  }, [])

  const changeViewMode = (value: MediaViewMode): void => {
    viewModeEditedRef.current = true
    setViewMode(value)
    void kvSet(KV_NAMESPACE, VIEW_MODE_KEY, value).catch(() => undefined)
  }

  const changeOutputDir = (value: string): void => {
    outputDirEditedRef.current = true
    setOutputDir(value)
    void kvSet(KV_NAMESPACE, OUTPUT_DIR_KEY, value).catch(() => undefined)
  }

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
    setPreviewJobs(null)
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

  const canShuffle = poolSize >= 2 && effOut >= 2
  const canCreate = canShuffle && draftsHydrated

  const doShuffle = (): void => {
    if (!canShuffle) return
    setPreviewJobs(buildJobs())
  }

  const createDrafts = (): void => {
    if (!canCreate) return
    const jobs = previewJobs ?? buildJobs()
    if (jobs.some((job) => job.length < 2)) {
      pushToast('error', t('Mỗi bản ghép cần ít nhất 2 video', 'Each merge needs at least 2 videos'))
      return
    }
    if (jobs.length === 0) {
      pushToast('error', t('Không thể tạo thêm tổ hợp video duy nhất', 'No unique video combination is available'))
      return
    }

    const createdAt = Date.now()
    const nextDrafts = jobs.map(
      (inputs, index): RandomDraft => ({
        id: createDraftId(),
        inputs: [...inputs],
        createdAt: createdAt + index,
        forceReencode,
        outputDir,
        leadCount: effLead
      })
    )
    commitDrafts((current) => [...current, ...nextDrafts])
    setPreviewJobs(null)
    pushToast(
      'success',
      t(
        `Đã thêm ${nextDrafts.length} bản ghép vào hàng đợi chờ`,
        `Added ${nextDrafts.length} merge(s) to the pending queue`
      )
    )
  }

  const runDrafts = async (requested: RandomDraft[]): Promise<void> => {
    const selected: RandomDraft[] = []
    for (const draft of requested) {
      if (submittingRef.current.has(draft.id)) continue
      submittingRef.current.add(draft.id)
      selected.push(draft)
    }
    if (selected.length === 0) return
    setSubmittingIds(new Set(submittingRef.current))

    const succeeded = new Set<string>()
    const failures: Array<{ draft: RandomDraft; error: unknown }> = []
    let cursor = 0
    const worker = async (): Promise<void> => {
      while (cursor < selected.length) {
        const draft = selected[cursor++]
        const payload: RandomStartPayload = {
          jobs: [[...draft.inputs]],
          forceReencode: draft.forceReencode,
          outputDir: draft.outputDir,
          draftId: draft.id
        }
        try {
          await invokeSilent<string[]>('mod:random:start', payload)
          succeeded.add(draft.id)
        } catch (error) {
          failures.push({ draft, error })
        }
      }
    }

    try {
      await Promise.all(Array.from({ length: Math.min(3, selected.length) }, () => worker()))
      if (succeeded.size > 0) {
        commitDrafts((current) => current.filter((draft) => !succeeded.has(draft.id)))
        pushToast(
          'success',
          t(
            `Đã chuyển ${succeeded.size} tác vụ sang hàng đợi xử lý`,
            `Sent ${succeeded.size} task(s) to the processing queue`
          )
        )
      }
      if (failures.length > 0) {
        const firstError = cleanError(failures[0].error)
        pushToast(
          'error',
          t(
            `${failures.length} tác vụ chưa thể chạy: ${firstError}`,
            `${failures.length} task(s) could not start: ${firstError}`
          )
        )
      }
    } finally {
      for (const draft of selected) submittingRef.current.delete(draft.id)
      setSubmittingIds(new Set(submittingRef.current))
    }
  }

  const removeDraft = (draft: RandomDraft): void => {
    if (submittingRef.current.has(draft.id)) return
    commitDrafts((current) => current.filter((item) => item.id !== draft.id))
  }

  const clearDrafts = (): void =>
    commitDrafts((current) => current.filter((draft) => submittingRef.current.has(draft.id)))

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
          <span className="right text-dim" style={{ fontSize: 12 }}>
            {poolSize > 0 && (
              <>
                <span>
                  {poolSize} {t('video', 'videos')} · {secToHms(totalDur)}
                </span>
                <button type="button" className="btn btn-sm btn-ghost" onClick={clearAll}>
                  {t('Xoá tất cả', 'Clear all')}
                </button>
              </>
            )}
            <ViewToggle value={viewMode} onChange={changeViewMode} />
          </span>
        </div>

        {poolSize > 0 && (
          <>
            <div className="rnd-hint mb">
              {t(
                'Kéo-thả để đổi thứ tự · số video đầu (🔒) giữ nguyên thứ tự này, các tile còn lại (🎲) là kho chọn ngẫu nhiên.',
                'Drag to reorder · the leading videos (🔒) keep this exact order, the remaining tiles (🎲) are the random pool.'
              )}
            </div>
            <div
              className={'rnd-grid mb' + (viewMode === 'list' ? ' list-view' : '')}
              role="list"
              aria-label={t('Danh sách video trong kho', 'Videos in pool')}
            >
              {tiles.map((it, idx) => {
                const lead = idx < effLead
                return (
                  <div
                    key={it.path}
                    role="listitem"
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
                    <div className="rnd-meta">
                      <div className="rnd-name ellipsis">{baseName(it.path)}</div>
                      <div className="rnd-path ellipsis">{it.path}</div>
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

        <Field
          label={t('Thư mục xuất', 'Output folder')}
          hint={t(
            'Để trống sẽ lưu cạnh video đầu tiên của mỗi bản. Thư mục được ghi nhớ và áp dụng cho các bản ghép tạo mới.',
            'Leave empty to save next to the first video of each merge. The folder is remembered and applies to newly created merges.'
          )}
        >
          <FolderInput
            value={outputDir}
            onChange={changeOutputDir}
            placeholder={t('Cạnh video nguồn', 'Next to the source video')}
          />
        </Field>

        <div className="row mt">
          <Check
            checked={forceReencode}
            onChange={setForceReencode}
            label={t('Luôn chuẩn hoá (re-encode)', 'Always normalize (re-encode)')}
          />
          <span className="hint">
            {t(
              'Bỏ trống: cùng chuẩn → ghép copy tức thì, khác chuẩn → tự re-encode. Video thiếu audio vẫn được ghép và tự chèn im lặng khi cần.',
              'Off: same format → instant copy merge, mixed → auto re-encode. Videos without audio are still merged, with silence added when needed.'
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
        <div className="hint mt">
          {t(
            'Nút Tạo chỉ thêm bản ghép vào hàng đợi chờ; video chỉ bắt đầu xử lý khi bạn bấm Chạy.',
            'Create only adds merges to the pending queue; processing starts when you press Run.'
          )}
        </div>

        {previewJobs && previewJobs.length > 0 && (
          <div className="rnd-preview mt">
            <div className="rnd-preview-head">
              {t('Xem trước bản 1', 'Preview #1')} / {previewJobs.length}
              {previewJobs.length > 1 && (
                <span className="text-dim">
                  {' '}
                  · {t(`+ ${previewJobs.length - 1} bản khác`, `+ ${previewJobs.length - 1} more`)}
                </span>
              )}
            </div>
            <div className="rnd-strip">
              {previewJobs[0].map((p, i) => {
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

      <MergeDraftQueue
        drafts={drafts}
        submittingIds={submittingIds}
        mediaWord={['video', 'video']}
        renderMedia={(path, index, draft) => {
          const tile = thumbByPath.get(path)
          const lead = index < draft.leadCount
          return (
            <div className="rnd-draft-thumb" title={path}>
              {tile?.thumb ? <img src={tile.thumb} alt="" /> : <span className="rnd-thumb-ph">🎬</span>}
              <span className={'rnd-strip-badge ' + (lead ? 'lead' : 'rand')}>
                {lead ? `🔒${index + 1}` : '🎲'}
              </span>
            </div>
          )
        }}
        renderDetails={(draft) => (
          <div className="rnd-draft-details">
            <span>
              {t('Video đầu cố định', 'Fixed leading')}: {draft.leadCount}
            </span>
            <span>
              {draft.forceReencode
                ? t('Chuẩn hoá bật', 'Normalize on')
                : t('Tự chọn chế độ ghép', 'Auto merge mode')}
            </span>
            <span className="ellipsis" title={draft.outputDir || t('Cạnh video đầu tiên', 'Next to the first video')}>
              {t('Đầu ra', 'Output')}: {draft.outputDir || t('Cạnh video đầu tiên', 'Next to the first video')}
            </span>
          </div>
        )}
        onRun={(draft) => void runDrafts([draft])}
        onRemove={removeDraft}
        onRunAll={() => void runDrafts(drafts)}
        onClear={clearDrafts}
      />

      <TaskTable types={['random']} />
    </div>
  )
}
