import { useEffect, useRef, useState } from 'react'
import type {
  PhotokeyColor,
  PhotokeyOptions,
  PhotokeyReadImagePayload,
  PhotokeyReadImageResult,
  PhotokeyRemoveFolderPayload,
  PhotokeyRemoveFolderResult,
  PhotokeyRemovePayload,
  PhotokeyRemoveResult
} from '@shared/modules/photokey'
import {
  invoke,
  invokeSilent,
  kvGet,
  kvSet,
  pathForFile,
  pickFolder,
  statPath
} from '../../api'
import { Field, FolderInput, NumInput, Select } from '../../components/Field'
import { FileDrop } from '../../components/FileDrop'
import { TaskTable } from '../../components/TaskTable'
import { useT } from '../../i18n'
import { useTask } from '../../store/tasks'
import { useUi } from '../../store/ui'
import './styles.css'

type SourceMode = 'single' | 'folder'

interface PersistedSettings extends PhotokeyOptions {
  outputDir: string
}

const KV_NAMESPACE = 'photokey'
const SETTINGS_KEY = 'settings-v1'
const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp', 'bmp']

const DEFAULT_OPTIONS: PhotokeyOptions = {
  color: 'green',
  tolLow: 0.04,
  tolHigh: 0.16,
  choke: 1,
  feather: 1,
  despill: 1
}

const DEFAULT_SETTINGS: PersistedSettings = {
  ...DEFAULT_OPTIONS,
  outputDir: ''
}

const baseName = (path: string): string => path.split(/[\\/]/).pop() ?? path

function numberInRange(value: unknown, fallback: number, min: number, max: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(max, Math.max(min, value))
    : fallback
}

function parseSettings(value: unknown): PersistedSettings {
  if (!value || typeof value !== 'object') return DEFAULT_SETTINGS
  const saved = value as Record<string, unknown>
  return {
    color: saved.color === 'blue' ? 'blue' : 'green',
    tolLow: numberInRange(saved.tolLow, DEFAULT_OPTIONS.tolLow, 0, 1),
    tolHigh: numberInRange(saved.tolHigh, DEFAULT_OPTIONS.tolHigh, 0, 1),
    choke: Math.round(numberInRange(saved.choke, DEFAULT_OPTIONS.choke, 0, 5)),
    feather: Math.round(numberInRange(saved.feather, DEFAULT_OPTIONS.feather, 0, 5)),
    despill: numberInRange(saved.despill, DEFAULT_OPTIONS.despill, 0, 1),
    outputDir: typeof saved.outputDir === 'string' ? saved.outputDir : ''
  }
}

async function readImage(path: string): Promise<string> {
  const payload: PhotokeyReadImagePayload = { path }
  const result = await invokeSilent<PhotokeyReadImageResult>('mod:photokey:read-image', payload)
  if (!result || typeof result.dataUrl !== 'string' || !result.dataUrl.startsWith('data:image/')) {
    throw new Error('Invalid image preview response')
  }
  return result.dataUrl
}

function FolderDrop({
  value,
  onChange
}: {
  value: string
  onChange: (value: string) => void
}): React.JSX.Element {
  const t = useT()
  const pushToast = useUi((state) => state.pushToast)
  const [over, setOver] = useState(false)

  const chooseFolder = async (): Promise<void> => {
    const folder = await pickFolder()
    if (folder) onChange(folder)
  }

  const acceptDrop = async (event: React.DragEvent<HTMLDivElement>): Promise<void> => {
    event.preventDefault()
    setOver(false)
    const file = Array.from(event.dataTransfer.files)[0]
    const path = file ? pathForFile(file) : ''
    if (!path) return
    const stat = await statPath(path)
    if (stat.exists && stat.isDirectory) {
      onChange(path)
      return
    }
    pushToast(
      'info',
      t('Chế độ thư mục chỉ nhận một thư mục ảnh.', 'Folder mode only accepts an image folder.')
    )
  }

  return (
    <div>
      {value && (
        <div className="photokey-folder-value mb">
          <span className="ellipsis grow" title={value}>
            📁 {value}
          </span>
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => onChange('')}>
            {t('Bỏ chọn', 'Clear')}
          </button>
        </div>
      )}
      <div
        className={`photokey-folder-drop${over ? ' over' : ''}`}
        onDragOver={(event) => {
          event.preventDefault()
          setOver(true)
        }}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOver(false)
        }}
        onDrop={(event) => void acceptDrop(event)}
      >
        <div className="photokey-folder-drop-copy">
          <strong>{t('Thả thư mục ảnh vào đây', 'Drop an image folder here')}</strong>
          <span>
            {t(
              'Chỉ ảnh ở cấp đầu của thư mục được xử lý; thư mục con không được quét.',
              'Only top-level images are processed; subfolders are not scanned.'
            )}
          </span>
        </div>
        <button type="button" className="btn btn-primary btn-sm" onClick={() => void chooseFolder()}>
          📁 {t('Chọn thư mục', 'Choose folder')}
        </button>
      </div>
    </div>
  )
}

function PreviewPane({
  title,
  url,
  alt,
  empty,
  busy,
  failed,
  checker
}: {
  title: string
  url: string
  alt: string
  empty: string
  busy: boolean
  failed: string
  checker?: boolean
}): React.JSX.Element {
  return (
    <div className="photokey-preview-pane">
      <div className="photokey-preview-title">{title}</div>
      <div className={`photokey-preview-canvas${checker ? ' checker' : ''}`}>
        {url ? (
          <img src={url} alt={alt} />
        ) : (
          <div className="photokey-preview-empty">
            {busy && <span className="spin" />}
            <span>{failed || empty}</span>
          </div>
        )}
      </div>
    </div>
  )
}

/** Remove green/blue backgrounds from still images and export transparent PNG files. */
export default function Photokey(): React.JSX.Element {
  const t = useT()
  const pushToast = useUi((state) => state.pushToast)

  const [mode, setMode] = useState<SourceMode>('single')
  const [inputs, setInputs] = useState<string[]>([])
  const [folder, setFolder] = useState('')
  const [outputDir, setOutputDir] = useState('')
  const [options, setOptions] = useState<PhotokeyOptions>(DEFAULT_OPTIONS)
  const [settingsHydrated, setSettingsHydrated] = useState(false)
  const [busy, setBusy] = useState(false)

  const [beforeUrl, setBeforeUrl] = useState('')
  const [beforeLoading, setBeforeLoading] = useState(false)
  const [beforeFailed, setBeforeFailed] = useState(false)
  const [afterUrl, setAfterUrl] = useState('')
  const [afterLoading, setAfterLoading] = useState(false)
  const [afterFailed, setAfterFailed] = useState(false)
  const [previewTaskId, setPreviewTaskId] = useState('')
  const [previewOutPath, setPreviewOutPath] = useState('')
  const loadedAfterPath = useRef('')
  const previewTask = useTask(previewTaskId)
  /** Người dùng đã chỉnh cấu hình trước khi kvGet trả về -> không ghi đè lựa chọn của họ. */
  const userTouchedRef = useRef(false)
  /** Kết quả enqueue của lượt chạy gần nhất theo ảnh nguồn — giữ preview đúng khi ảnh đầu bị bỏ. */
  const batchRef = useRef<Record<string, PhotokeyRemoveResult>>({})
  /** Bump khi blur để remount NumInput nguyên (choke/feather), đồng bộ text hiển thị với giá trị đã làm tròn. */
  const [chokeSeq, setChokeSeq] = useState(0)
  const [featherSeq, setFeatherSeq] = useState(0)

  const firstInput = inputs[0] ?? ''
  const thresholdsValid = options.tolHigh > options.tolLow
  const hasSource = mode === 'single' ? inputs.length > 0 : !!folder
  const canRun = hasSource && thresholdsValid && !busy
  const imageFilters = [{ name: t('Ảnh', 'Images'), extensions: IMAGE_EXTENSIONS }]

  useEffect(() => {
    let alive = true
    void kvGet<unknown>(KV_NAMESPACE, SETTINGS_KEY, DEFAULT_SETTINGS)
      .then((saved) => {
        if (!alive) return
        if (!userTouchedRef.current) {
          const parsed = parseSettings(saved)
          setOutputDir(parsed.outputDir)
          setOptions({
            color: parsed.color,
            tolLow: parsed.tolLow,
            tolHigh: parsed.tolHigh,
            choke: parsed.choke,
            feather: parsed.feather,
            despill: parsed.despill
          })
        }
        setSettingsHydrated(true)
      })
      .catch(() => {
        if (alive) setSettingsHydrated(true)
      })
    return () => {
      alive = false
    }
  }, [])

  useEffect(() => {
    if (!settingsHydrated) return
    const saved: PersistedSettings = { ...options, outputDir }
    void kvSet(KV_NAMESPACE, SETTINGS_KEY, saved).catch(() => undefined)
  }, [options, outputDir, settingsHydrated])

  useEffect(() => {
    setBeforeUrl('')
    setBeforeFailed(false)
    setBeforeLoading(!!firstInput)
    setAfterUrl('')
    setAfterFailed(false)
    setAfterLoading(false)
    // Ảnh đầu mới có thể đã được enqueue trong lượt chạy gần nhất (vd bỏ ảnh
    // đầu cũ khỏi danh sách) — tiếp tục theo dõi task của nó thay vì bỏ trống.
    const tracked = firstInput ? batchRef.current[firstInput] : undefined
    setPreviewTaskId(tracked?.taskId ?? '')
    setPreviewOutPath(tracked?.outPath ?? '')
    loadedAfterPath.current = ''
    if (!firstInput) return

    let alive = true
    void readImage(firstInput)
      .then((url) => {
        if (alive) setBeforeUrl(url)
      })
      .catch(() => {
        if (alive) setBeforeFailed(true)
      })
      .finally(() => {
        if (alive) setBeforeLoading(false)
      })
    return () => {
      alive = false
    }
  }, [firstInput])

  useEffect(() => {
    if (previewTask?.status !== 'completed') {
      // Task bị xóa khỏi store (Clear finished) giữa lúc đọc kết quả: hủy trạng
      // thái loading để AFTER không kẹt spinner vĩnh viễn.
      if (!previewTask) setAfterLoading(false)
      return
    }
    const outputPath = previewTask.outputPath || previewOutPath
    if (!outputPath || loadedAfterPath.current === outputPath) return
    loadedAfterPath.current = outputPath
    let alive = true
    setAfterLoading(true)
    setAfterFailed(false)
    void readImage(outputPath)
      .then((url) => {
        if (alive) setAfterUrl(url)
      })
      .catch(() => {
        if (alive) setAfterFailed(true)
      })
      .finally(() => {
        if (alive) setAfterLoading(false)
      })
    return () => {
      alive = false
    }
  }, [previewOutPath, previewTask?.outputPath, previewTask?.status])

  const addFiles = (paths: string[]): void => {
    setInputs((current) => {
      const known = new Set(current.map((path) => path.toLowerCase()))
      const fresh = paths.filter((path) => {
        const key = path.toLowerCase()
        if (!path || known.has(key)) return false
        known.add(key)
        return true
      })
      return fresh.length ? [...current, ...fresh] : current
    })
  }

  const removeFile = (path: string): void => {
    setInputs((current) => current.filter((item) => item !== path))
  }

  const patchOptions = (patch: Partial<PhotokeyOptions>): void => {
    userTouchedRef.current = true
    setOptions((current) => ({ ...current, ...patch }))
  }

  const changeOutputDir = (value: string): void => {
    userTouchedRef.current = true
    setOutputDir(value)
  }

  const resetAdvanced = (): void => {
    userTouchedRef.current = true
    setOptions((current) => ({ ...DEFAULT_OPTIONS, color: current.color }))
    setChokeSeq((n) => n + 1)
    setFeatherSeq((n) => n + 1)
  }

  const runSingle = async (): Promise<void> => {
    const sources = [...inputs]
    setAfterUrl('')
    setAfterFailed(false)
    setAfterLoading(false)
    setPreviewTaskId('')
    setPreviewOutPath('')
    loadedAfterPath.current = ''

    const requests = sources.map((src) => {
      const payload: PhotokeyRemovePayload = {
        src,
        outputDir: outputDir || undefined,
        ...options
      }
      return invoke<PhotokeyRemoveResult>('mod:photokey:remove', payload)
    })
    const results = await Promise.allSettled(requests)
    const batch: Record<string, PhotokeyRemoveResult> = {}
    results.forEach((result, index) => {
      if (result.status === 'fulfilled') batch[sources[index]] = result.value
    })
    batchRef.current = batch
    const firstResult = results[0]
    if (firstResult?.status === 'fulfilled') {
      setPreviewTaskId(firstResult.value.taskId)
      setPreviewOutPath(firstResult.value.outPath)
    }
    const queued = results.filter((result) => result.status === 'fulfilled').length
    if (queued > 0) {
      pushToast(
        'success',
        t(
          `Đã thêm ${queued} ảnh vào hàng đợi xóa nền`,
          `Queued ${queued} image(s) for background removal`
        )
      )
    }
  }

  const runFolder = async (): Promise<void> => {
    const payload: PhotokeyRemoveFolderPayload = {
      dir: folder,
      outputDir: outputDir || undefined,
      ...options
    }
    const result = await invoke<PhotokeyRemoveFolderResult>('mod:photokey:remove-folder', payload)
    pushToast(
      'success',
      t(
        `Đã thêm ${result.count} ảnh vào hàng đợi xóa nền`,
        `Queued ${result.count} image(s) for background removal`
      )
    )
  }

  const run = async (): Promise<void> => {
    if (!canRun) return
    setBusy(true)
    try {
      if (mode === 'single') await runSingle()
      else await runFolder()
    } catch {
      /* invoke đã hiện toast lỗi */
    } finally {
      setBusy(false)
    }
  }

  const previewTaskActive =
    previewTask?.status === 'queued' || previewTask?.status === 'running'
  const previewTaskFailed =
    previewTask?.status === 'error' || previewTask?.status === 'killed'

  return (
    <div>
      <div className="page-title">
        {t('Xóa Nền Ảnh (Photokey)', 'Photo Background Removal')}
      </div>
      <div className="page-desc">
        {t(
          'Xóa phông xanh lá hoặc xanh dương khỏi ảnh tĩnh và xuất PNG trong suốt, giữ mép mềm và giảm ám màu.',
          'Remove green or blue screens from still images and export transparent PNG files with soft, despilled edges.'
        )}
      </div>

      <div className="card">
        <div className="card-title">{t('Cấu hình Photokey', 'Photokey settings')}</div>

        <Field label={t('Chế độ nguồn', 'Source mode')}>
          <div className="photokey-mode" role="group" aria-label={t('Chế độ nguồn', 'Source mode')}>
            <button
              type="button"
              className={mode === 'single' ? 'active' : ''}
              aria-pressed={mode === 'single'}
              onClick={() => setMode('single')}
            >
              {t('Ảnh đơn / nhiều ảnh', 'Single / multiple images')}
            </button>
            <button
              type="button"
              className={mode === 'folder' ? 'active' : ''}
              aria-pressed={mode === 'folder'}
              onClick={() => setMode('folder')}
            >
              {t('Thư mục', 'Folder')}
            </button>
          </div>
        </Field>

        {mode === 'single' ? (
          <Field
            label={t('Ảnh nguồn', 'Source images')}
            hint={t(
              'Có thể chọn hoặc thả nhiều ảnh; mỗi ảnh tạo một tác vụ riêng.',
              'Select or drop multiple images; each image creates its own task.'
            )}
          >
            <div>
              {inputs.length > 0 && (
                <div className="photokey-files table-wrap mb">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>#</th>
                        <th>{t('Ảnh', 'Image')}</th>
                        <th>{t('Đường dẫn', 'Path')}</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {inputs.map((path, index) => (
                        <tr key={path}>
                          <td className="mono">{index + 1}</td>
                          <td className="ellipsis" title={baseName(path)}>
                            🖼️ {baseName(path)}
                            {index === 0 && (
                              <span className="badge photokey-first-badge">
                                {t('Xem trước', 'Preview')}
                              </span>
                            )}
                          </td>
                          <td className="ellipsis text-dim" title={path}>
                            {path}
                          </td>
                          <td style={{ textAlign: 'right' }}>
                            <button
                              type="button"
                              className="btn btn-sm btn-ghost"
                              aria-label={t('Bỏ ảnh khỏi danh sách', 'Remove image from list')}
                              title={t('Bỏ ảnh khỏi danh sách', 'Remove image from list')}
                              onClick={() => removeFile(path)}
                            >
                              ✕
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <FileDrop
                multi
                allowFolder={false}
                accept={imageFilters}
                hint={t(
                  'Kéo-thả PNG, JPG, JPEG, WebP hoặc BMP vào đây.',
                  'Drop PNG, JPG, JPEG, WebP, or BMP images here.'
                )}
                onFiles={addFiles}
              />
              {inputs.length > 0 && (
                <div className="row mt">
                  <span className="hint">
                    {t(`${inputs.length} ảnh đã chọn`, `${inputs.length} image(s) selected`)}
                  </span>
                  <button type="button" className="btn btn-sm btn-ghost" onClick={() => setInputs([])}>
                    {t('Xóa danh sách', 'Clear list')}
                  </button>
                </div>
              )}
            </div>
          </Field>
        ) : (
          <Field label={t('Thư mục ảnh nguồn', 'Source image folder')}>
            <FolderDrop value={folder} onChange={setFolder} />
          </Field>
        )}

        <div className="grid-2">
          <Field
            label={t('Thư mục xuất', 'Output folder')}
            hint={t(
              'Để trống sẽ lưu PNG cạnh từng ảnh gốc. Lựa chọn này được ghi nhớ.',
              'Leave empty to save PNG files next to each source image. This choice is remembered.'
            )}
          >
            <FolderInput
              value={outputDir}
              onChange={changeOutputDir}
              placeholder={t('Cạnh ảnh gốc', 'Next to source image')}
            />
          </Field>
          <Field label={t('Màu phông', 'Screen color')}>
            <Select<PhotokeyColor>
              value={options.color}
              onChange={(color) => patchOptions({ color })}
              options={[
                { value: 'green', label: t('Xanh lá', 'Green') },
                { value: 'blue', label: t('Xanh dương', 'Blue') }
              ]}
            />
          </Field>
        </div>

        <div className="photokey-subsection-head">
          <span>{t('Nâng cao', 'Advanced')}</span>
          <button type="button" className="btn btn-sm btn-ghost" onClick={resetAdvanced}>
            {t('Mặc định', 'Defaults')}
          </button>
        </div>

        <div className="photokey-advanced-grid">
          <Field
            label={t('Ngưỡng thấp (tolLow)', 'Low threshold (tolLow)')}
            hint={t(
              'Tăng khi nền không đều; giảm nếu chi tiết xanh nhạt của chủ thể bị mất.',
              'Raise for uneven screens; lower if pale green subject details disappear.'
            )}
          >
            <NumInput
              value={options.tolLow}
              onChange={(tolLow) => patchOptions({ tolLow })}
              min={0}
              max={1}
              step={0.01}
            />
          </Field>
          <Field
            label={t('Ngưỡng cao (tolHigh)', 'High threshold (tolHigh)')}
            hint={t(
              'Tăng khi còn viền màu mờ; giảm nếu mép chủ thể bị gặm quá tay.',
              'Raise if a faint colored fringe remains; lower if subject edges are over-cut.'
            )}
          >
            <NumInput
              value={options.tolHigh}
              onChange={(tolHigh) => patchOptions({ tolHigh })}
              min={0}
              max={1}
              step={0.01}
            />
          </Field>
          <Field
            label={t('Co biên (choke)', 'Edge choke')}
            hint={t(
              'Tăng để diệt quầng màu 1–2 px; giảm để giữ lông hoặc chữ nhỏ.',
              'Raise to remove a 1–2 px fringe; lower to preserve hair or small text.'
            )}
          >
            {/* Remount khi blur: NumInput giữ text thô người dùng gõ (vd "2.7") kể cả
                khi giá trị đã bị làm tròn — remount ép hiển thị đúng số nguyên đang dùng. */}
            <div onBlur={() => setChokeSeq((n) => n + 1)}>
              <NumInput
                key={chokeSeq}
                value={options.choke}
                onChange={(choke) => patchOptions({ choke: Math.round(choke) })}
                min={0}
                max={5}
                step={1}
              />
            </div>
          </Field>
          <Field
            label={t('Làm mềm (feather)', 'Edge feather')}
            hint={t(
              'Tăng khi mép răng cưa; giảm nếu mép trở nên quá mờ.',
              'Raise for jagged edges; lower if the edge becomes too soft.'
            )}
          >
            <div onBlur={() => setFeatherSeq((n) => n + 1)}>
              <NumInput
                key={featherSeq}
                value={options.feather}
                onChange={(feather) => patchOptions({ feather: Math.round(feather) })}
                min={0}
                max={5}
                step={1}
              />
            </div>
          </Field>
          <Field
            label={t('Khử ám màu (despill)', 'Despill')}
            hint={t(
              'Tăng nếu chủ thể còn ám màu phông; giảm để giữ chi tiết xanh thật.',
              'Raise if the subject retains screen spill; lower to preserve genuine green/blue details.'
            )}
          >
            <NumInput
              value={options.despill}
              onChange={(despill) => patchOptions({ despill })}
              min={0}
              max={1}
              step={0.01}
            />
          </Field>
        </div>

        {!thresholdsValid && (
          <div className="text-danger photokey-validation">
            {t(
              'Ngưỡng cao phải lớn hơn ngưỡng thấp.',
              'The high threshold must be greater than the low threshold.'
            )}
          </div>
        )}

        <div className="row wrap mt">
          <button type="button" className="btn btn-primary" disabled={!canRun} onClick={() => void run()}>
            ✨ {busy ? t('Đang thêm tác vụ...', 'Queueing tasks...') : t('Xóa nền', 'Remove background')}
          </button>
          <span className="hint">
            {mode === 'single'
              ? inputs.length > 0
                ? t(
                    `${inputs.length} ảnh → ${inputs.length} tác vụ PNG`,
                    `${inputs.length} image(s) → ${inputs.length} PNG task(s)`
                  )
                : t('Chọn ít nhất một ảnh để bắt đầu.', 'Select at least one image to begin.')
              : folder
                ? t('Mỗi ảnh cấp đầu tạo một tác vụ riêng.', 'Each top-level image creates its own task.')
                : t('Chọn một thư mục ảnh để bắt đầu.', 'Choose an image folder to begin.')}
          </span>
        </div>
      </div>

      <div className="card">
        <div className="card-title">{t('Xem trước ảnh đầu tiên', 'First image preview')}</div>
        <div className="photokey-preview-grid">
          <PreviewPane
            title={t('TRƯỚC', 'BEFORE')}
            url={mode === 'single' ? beforeUrl : ''}
            alt={t('Ảnh trước khi xóa nền', 'Image before background removal')}
            busy={mode === 'single' && beforeLoading}
            failed={
              mode === 'single' && beforeFailed
                ? t('Không thể đọc ảnh nguồn.', 'Could not read the source image.')
                : ''
            }
            empty={
              mode === 'folder'
                ? t('Chế độ thư mục không xem trước từng ảnh.', 'Folder mode does not preview individual images.')
                : t('Ảnh đầu tiên đã chọn sẽ hiện ở đây.', 'The first selected image will appear here.')
            }
          />
          <PreviewPane
            title={t('SAU', 'AFTER')}
            url={mode === 'single' ? afterUrl : ''}
            alt={t('Ảnh trong suốt sau khi xóa nền', 'Transparent image after background removal')}
            checker
            busy={mode === 'single' && (afterLoading || previewTaskActive)}
            failed={
              mode === 'single' && (afterFailed || previewTaskFailed)
                ? afterFailed
                  ? t('Không thể tải ảnh kết quả.', 'Could not load the result image.')
                  : t('Tác vụ xem trước không hoàn tất.', 'The preview task did not complete.')
                : ''
            }
            empty={
              mode === 'folder'
                ? t('Theo dõi kết quả thư mục trong bảng tác vụ.', 'Track folder results in the task table.')
                : t(
                    'Kết quả sẽ tự cập nhật khi tác vụ ảnh đầu tiên hoàn tất.',
                    'The result updates automatically when the first image task completes.'
                  )
            }
          />
        </div>
      </div>

      <TaskTable types={['photokey']} />
    </div>
  )
}
