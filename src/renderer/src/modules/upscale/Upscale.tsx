import { useEffect, useRef, useState } from 'react'
import type { MediaInfo } from '@shared/types'
import type {
  UpscaleEngine,
  UpscaleEngineStatus,
  UpscaleModel,
  UpscaleStartPayload,
  UpscaleStartResult
} from '@shared/modules/upscale'
import { fmtBytes, secToHms } from '@shared/time'
import { invoke, invokeSilent } from '../../api'
import { Field, Select } from '../../components/Field'
import { FileDrop } from '../../components/FileDrop'
import { TaskTable } from '../../components/TaskTable'
import { useT } from '../../i18n'
import { useSettings } from '../../store/settings'
import { useTasks } from '../../store/tasks'
import { useUi } from '../../store/ui'

interface Item {
  path: string
  info?: MediaInfo
  error?: boolean
}

const baseName = (p: string): string => p.split(/[\\/]/).pop() ?? p

/** Kích thước đích dự kiến: scale để cạnh NGẮN = target, giữ tỉ lệ, làm tròn chẵn. */
function predictSize(w: number, h: number, target: number): { w: number; h: number } {
  const short = Math.min(w, h)
  if (short <= 0) return { w, h }
  const f = target / short
  const even = (n: number): number => Math.max(2, Math.round((n * f) / 2) * 2)
  return { w: even(w), h: even(h) }
}

/**
 * Module Nâng cấp 4K (AI Upscale):
 * - Engine AI Real-ESRGAN: rã khung hình → upscale từng hình → nén lại (cực nét, chậm)
 * - Engine Nhanh: FFmpeg Lanczos + CAS
 */
export default function Upscale(): React.JSX.Element {
  const t = useT()
  const pushToast = useUi((s) => s.pushToast)
  const outputDir = useSettings((s) => s.settings?.outputDir ?? '')

  // ---- Engine AI status ----
  const [status, setStatus] = useState<UpscaleEngineStatus | null>(null)
  const [statusChecked, setStatusChecked] = useState(false)
  const [fetchBusy, setFetchBusy] = useState(false)
  const autoPicked = useRef(false)

  // đếm task fetch-upscale-engine đã kết thúc → tự gọi lại engineStatus (pattern Updater)
  const engineDoneCount = useTasks((s) =>
    s.order.reduce((n, id) => {
      const task = s.byId[id]
      return task &&
        task.type === 'fetch-upscale-engine' &&
        (task.status === 'completed' || task.status === 'error' || task.status === 'killed')
        ? n + 1
        : n
    }, 0)
  )

  // đang có task tải engine chờ/chạy → khoá nút tải trong suốt quá trình download
  // (fetchBusy chỉ phủ vòng invoke enqueue — không đủ để chặn bấm lần 2 khi đang tải)
  const engineFetching = useTasks((s) =>
    s.order.some((id) => {
      const task = s.byId[id]
      return (
        !!task &&
        task.type === 'fetch-upscale-engine' &&
        (task.status === 'queued' || task.status === 'running')
      )
    })
  )

  useEffect(() => {
    // chạy lúc mount + mỗi khi task tải engine kết thúc
    void invokeSilent<UpscaleEngineStatus>('mod:upscale:engineStatus')
      .then((s) => {
        setStatus(s)
        setStatusChecked(true)
      })
      .catch(() => {
        setStatus(null)
        setStatusChecked(true)
      })
  }, [engineDoneCount])

  const installed = !!status?.installed

  // ---- Danh sách file nguồn ----
  const [items, setItems] = useState<Item[]>([])
  const known = useRef<Set<string>>(new Set())

  const addFiles = async (paths: string[]): Promise<void> => {
    const fresh = paths.filter((p) => p && !known.current.has(p))
    if (!fresh.length) return
    for (const p of fresh) known.current.add(p)
    setItems((prev) => [...prev, ...fresh.map((p) => ({ path: p }))])
    for (const p of fresh) {
      try {
        const info = await invokeSilent<MediaInfo>('core:probe', { path: p })
        setItems((prev) => prev.map((it) => (it.path === p ? { ...it, info } : it)))
      } catch {
        setItems((prev) => prev.map((it) => (it.path === p ? { ...it, error: true } : it)))
      }
    }
  }

  const removeItem = (p: string): void => {
    known.current.delete(p)
    setItems((prev) => prev.filter((it) => it.path !== p))
  }

  const clearAll = (): void => {
    known.current.clear()
    setItems([])
  }

  // ---- Thiết lập ----
  const [engine, setEngine] = useState<UpscaleEngine>('fast')
  const [model, setModel] = useState<UpscaleModel>('realesrgan-x4plus')
  const [target, setTarget] = useState<2160 | 1440>(2160)
  const [codec, setCodec] = useState<'h264' | 'hevc'>('hevc')
  const [busy, setBusy] = useState(false)

  // engine AI vừa phát hiện đã cài → tự chọn AI (1 lần); chưa cài → ép về Nhanh
  useEffect(() => {
    if (installed && !autoPicked.current) {
      autoPicked.current = true
      setEngine('realesrgan')
    }
    if (statusChecked && !installed) setEngine('fast')
  }, [installed, statusChecked])

  const fetchEngine = async (): Promise<void> => {
    setFetchBusy(true)
    try {
      await invoke('mod:upscale:fetchEngine')
      pushToast(
        'info',
        t('Đang tải engine AI (~140MB) — theo dõi ở bảng tác vụ', 'Downloading AI engine (~140MB) — see task table')
      )
    } catch {
      /* invoke đã hiện toast lỗi */
    } finally {
      setFetchBusy(false)
    }
  }

  const run = async (): Promise<void> => {
    if (!items.length || busy) return
    setBusy(true)
    try {
      const payload: UpscaleStartPayload = {
        inputs: items.map((it) => it.path),
        engine,
        model,
        target,
        codec,
        outputDir
      }
      const res = await invoke<UpscaleStartResult>('mod:upscale:start', payload)
      if (res.errors.length) {
        pushToast(
          'error',
          `${t(`${res.errors.length} file lỗi`, `${res.errors.length} file(s) failed`)}: ` +
            res.errors.map((e) => `${baseName(e.input)} — ${e.error}`).join(' | ')
        )
      }
      if (res.taskIds.length) {
        pushToast(
          'success',
          t(`Đã thêm ${res.taskIds.length} video vào hàng đợi`, `Queued ${res.taskIds.length} video(s)`)
        )
      }
    } finally {
      setBusy(false)
    }
  }

  // Ước tính đĩa tạm cho chế độ AI: ≈ 10MB × số khung hình
  const totalFrames = items.reduce(
    (s, it) => s + (it.info ? it.info.durationSec * (it.info.video?.fps || 30) : 0),
    0
  )
  const totalSec = items.reduce((s, it) => s + (it.info?.durationSec ?? 0), 0)
  const estTempBytes = totalFrames * 10 * 1024 * 1024

  const engineHint = statusChecked
    ? t('chưa cài engine — tải ở thẻ Engine AI phía trên', 'engine not installed — download it in the AI Engine card above')
    : t('đang kiểm tra engine...', 'checking engine...')

  return (
    <div>
      <div className="page-title">{t('Nâng cấp 4K (AI)', 'AI Upscale 4K')}</div>
      <div className="page-desc">
        {t(
          'AI rã video thành từng khung hình → nâng cấp từng hình bằng Real-ESRGAN → nén lại thành video. Kết quả cực nét nhưng chậm và cần vài GB đĩa trống tạm. Chế độ Nhanh dùng FFmpeg Lanczos + CAS — nhanh hơn nhiều, độ nét khá.',
          'AI extracts every frame → upscales each one with Real-ESRGAN → re-encodes into a video. Extremely sharp but slow and needs several GB of temporary disk space. Fast mode uses FFmpeg Lanczos + CAS — much faster, decent sharpness.'
        )}
      </div>

      <div className="card">
        <div className="card-title">
          {t('Engine AI', 'AI Engine')}
          <span className="right">
            <button
              className="btn btn-sm btn-ghost"
              onClick={() =>
                void invokeSilent<UpscaleEngineStatus>('mod:upscale:engineStatus')
                  .then((s) => {
                    setStatus(s)
                    setStatusChecked(true)
                  })
                  .catch(() => setStatusChecked(true))
              }
            >
              {t('Làm mới', 'Refresh')}
            </button>
          </span>
        </div>
        {!statusChecked ? (
          <div className="text-dim">
            <span className="spin">⏳</span> {t('Đang kiểm tra engine Real-ESRGAN...', 'Checking Real-ESRGAN engine...')}
          </div>
        ) : installed ? (
          <div className="row wrap">
            <span className="text-success">✅ {t('Đã cài Real-ESRGAN', 'Real-ESRGAN installed')}</span>
            <span className="text-dim ellipsis mono" style={{ fontSize: 12, maxWidth: 520 }} title={status?.exePath ?? ''}>
              {status?.exePath}
            </span>
          </div>
        ) : (
          <div className="row wrap">
            <span className="text-danger">
              ⚠️{' '}
              {t(
                'Chưa cài engine Real-ESRGAN — chế độ AI sẽ bị khoá cho đến khi tải xong.',
                'Real-ESRGAN engine is not installed — AI mode is locked until it is downloaded.'
              )}
            </span>
            <button
              className="btn btn-primary btn-sm"
              disabled={fetchBusy || engineFetching}
              onClick={() => void fetchEngine()}
            >
              ⬇{' '}
              {engineFetching
                ? t('Đang tải engine...', 'Downloading engine...')
                : t('Tải engine AI (~140MB)', 'Download AI engine (~140MB)')}
            </button>
          </div>
        )}
      </div>

      <div className="card">
        <div className="card-title">
          {t('Nguồn video', 'Source videos')} <span className="badge">{items.length}</span>
          {items.length > 0 && (
            <span className="right">
              {totalSec > 0 && (
                <span className="text-dim" style={{ fontSize: 12, marginRight: 8 }}>
                  {t('Tổng thời lượng', 'Total duration')}: {secToHms(Math.round(totalSec))}
                </span>
              )}
              <button className="btn btn-sm btn-danger" onClick={clearAll}>
                🗑 {t('Xoá tất cả', 'Clear all')}
              </button>
            </span>
          )}
        </div>

        {items.length > 0 && (
          <div className="table-wrap mb" style={{ maxHeight: 260 }}>
            <table className="table">
              <thead>
                <tr>
                  <th>{t('Tên file', 'File name')}</th>
                  <th>{t('Thời lượng', 'Duration')}</th>
                  <th>{t('Độ phân giải', 'Resolution')}</th>
                  <th>Codec</th>
                  <th>{t('Dung lượng', 'Size')}</th>
                  <th style={{ textAlign: 'right' }}></th>
                </tr>
              </thead>
              <tbody>
                {items.map((it) => {
                  const v = it.info?.video
                  const pred = v ? predictSize(v.width, v.height, target) : null
                  const already = !!v && Math.min(v.width, v.height) >= target
                  return (
                    <tr key={it.path}>
                      <td className="ellipsis" style={{ maxWidth: 280 }} title={it.path}>
                        🎬 {baseName(it.path)}
                      </td>
                      <td className="mono">
                        {it.info ? secToHms(it.info.durationSec) : it.error ? '—' : <span className="text-faint">…</span>}
                      </td>
                      <td>
                        {v && pred ? (
                          <span className="mono" style={{ fontSize: 12 }}>
                            {v.width}×{v.height} → <b>{pred.w}×{pred.h}</b>{' '}
                            {already && (
                              <span className="chip" title={t('Cạnh ngắn đã đạt/vượt độ phân giải đích', 'Short side already at/above target resolution')}>
                                ⚠ {t('Đã ≥ đích', 'Already ≥ target')}
                              </span>
                            )}
                          </span>
                        ) : it.error ? (
                          <span className="text-danger">{t('Lỗi đọc file', 'Unreadable')}</span>
                        ) : (
                          ''
                        )}
                      </td>
                      <td className="text-dim">{v ? v.codec.toUpperCase() : ''}</td>
                      <td className="text-dim">{it.info ? fmtBytes(it.info.sizeBytes) : ''}</td>
                      <td style={{ textAlign: 'right' }}>
                        <button
                          className="btn btn-sm btn-ghost"
                          title={t('Xoá khỏi danh sách', 'Remove from list')}
                          onClick={() => removeItem(it.path)}
                        >
                          🗑
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}

        <FileDrop multi allowFolder onFiles={(p) => void addFiles(p)} />
      </div>

      <div className="card">
        <div className="card-title">{t('Thiết lập', 'Settings')}</div>

        <div className="row wrap">
          <label className="check" title={!installed ? engineHint : ''}>
            <input
              type="radio"
              name="upscale-engine"
              checked={engine === 'realesrgan'}
              disabled={!installed}
              onChange={() => setEngine('realesrgan')}
            />
            ✨ {t('AI Real-ESRGAN (cực nét, chậm)', 'AI Real-ESRGAN (sharpest, slow)')}
            {!installed && (
              <span className="text-faint" style={{ fontSize: 12 }}>
                ({engineHint})
              </span>
            )}
          </label>
          <label className="check">
            <input
              type="radio"
              name="upscale-engine"
              checked={engine === 'fast'}
              onChange={() => setEngine('fast')}
            />
            ⚡ {t('Nhanh (Lanczos + CAS)', 'Fast (Lanczos + CAS)')}
          </label>
        </div>

        <div className="grid-3 mt">
          {engine === 'realesrgan' && (
            <Field label={t('Model AI', 'AI model')}>
              <Select<UpscaleModel>
                value={model}
                onChange={setModel}
                options={[
                  { value: 'realesrgan-x4plus', label: t('Video quay thực (x4plus)', 'Real-world footage (x4plus)') },
                  { value: 'realesrgan-x4plus-anime', label: t('Anime (x4plus-anime)', 'Anime (x4plus-anime)') },
                  { value: 'realesr-animevideov3', label: t('Video anime nhanh (animevideov3)', 'Fast anime video (animevideov3)') }
                ]}
              />
            </Field>
          )}

          <Field label={t('Độ phân giải đích', 'Target resolution')}>
            <Select<2160 | 1440>
              value={target}
              onChange={setTarget}
              options={[
                { value: 2160, label: '4K UHD (2160p)' },
                { value: 1440, label: '2K QHD (1440p)' }
              ]}
            />
          </Field>

          <Field label="Codec">
            <Select<'h264' | 'hevc'>
              value={codec}
              onChange={setCodec}
              options={[
                { value: 'hevc', label: t('HEVC/H265 (khuyến nghị 4K, file nhỏ)', 'HEVC/H265 (recommended for 4K, smaller)') },
                { value: 'h264', label: t('H264 (tương thích rộng)', 'H264 (widest compatibility)') }
              ]}
            />
          </Field>
        </div>

        {engine === 'realesrgan' && (
          <div className="hint mt">
            💾{' '}
            {t(
              'Cần đĩa trống tạm ≈ 10MB × số khung hình (video 1 phút 30fps ≈ 18GB).',
              'Needs temporary disk space ≈ 10MB × frame count (1-minute 30fps video ≈ 18GB).'
            )}
            {totalFrames > 0 && (
              <>
                {' '}
                {t(
                  `Với ${items.length} file đã chọn (~${Math.round(totalFrames).toLocaleString()} khung hình) ≈ ${fmtBytes(estTempBytes)}.`,
                  `For the ${items.length} selected file(s) (~${Math.round(totalFrames).toLocaleString()} frames) ≈ ${fmtBytes(estTempBytes)}.`
                )}
              </>
            )}
          </div>
        )}

        <div className="row mt">
          <button
            className="btn btn-primary"
            disabled={!items.length || busy || (engine === 'realesrgan' && !installed)}
            onClick={() => void run()}
          >
            ✨ {t('Bắt đầu nâng cấp', 'Start upscaling')}
          </button>
          <span className="hint">
            {items.length > 0
              ? t(`${items.length} file → hàng đợi`, `${items.length} file(s) → queue`)
              : t('Thêm file để bắt đầu', 'Add files to start')}{' '}
            ·{' '}
            {outputDir
              ? `${t('Xuất', 'Output')} → ${outputDir}`
              : t('xuất cùng thư mục file gốc', 'output next to source files')}
          </span>
        </div>
      </div>

      <TaskTable types={['upscale', 'fetch-upscale-engine']} />
    </div>
  )
}
