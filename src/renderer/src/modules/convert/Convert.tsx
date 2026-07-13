import { useEffect, useRef, useState } from 'react'
import type { MediaInfo } from '@shared/types'
import type {
  ConvertOutputFormat,
  ConvertStartPayload,
  ConvertStartResult
} from '@shared/modules/convert'
import { fmtBytes, secToHms } from '@shared/time'
import { invoke, invokeSilent, kvGet, kvSet } from '../../api'
import { Field, FolderInput, Select } from '../../components/Field'
import { FileDrop } from '../../components/FileDrop'
import { TaskTable } from '../../components/TaskTable'
import { useT } from '../../i18n'
import { useSettings } from '../../store/settings'
import { useUi } from '../../store/ui'

interface Item {
  path: string
  info?: MediaInfo
  error?: boolean
}

const VIDEO_FILTER = [
  {
    name: 'Video',
    extensions: [
      'mp4',
      'mkv',
      'mov',
      'avi',
      'flv',
      'webm',
      'ts',
      'm2ts',
      'wmv',
      'mpg',
      'mpeg',
      '3gp',
      'm4v'
    ]
  }
]

const baseName = (filePath: string): string => filePath.split(/[\\/]/).pop() ?? filePath

const sourceFormat = (filePath: string): string => {
  const name = baseName(filePath)
  const dot = name.lastIndexOf('.')
  return dot >= 0 ? name.slice(dot + 1).toUpperCase() : '—'
}

/** Chuyển đổi nhiều video sang MP4 hoặc FLV bằng các task FFmpeg song song. */
export default function Convert(): React.JSX.Element {
  const t = useT()
  const pushToast = useUi((state) => state.pushToast)
  const settings = useSettings((state) => state.settings)
  const defaultOutputDir = settings?.outputDir ?? ''
  const cpuCap = Math.max(1, Math.floor((navigator.hardwareConcurrency || 2) / 2))
  const parallelTasks = Math.min(settings?.maxFfmpeg ?? 1, cpuCap)

  const [items, setItems] = useState<Item[]>([])
  const [format, setFormat] = useState<ConvertOutputFormat>('mp4')
  const [outputDir, setOutputDir] = useState(defaultOutputDir)
  const [busy, setBusy] = useState(false)
  const known = useRef<Set<string>>(new Set())

  useEffect(() => {
    let alive = true
    void Promise.all([
      kvGet<string>('convert', 'format', 'mp4'),
      kvGet<string>('convert', 'outputDir', defaultOutputDir)
    ]).then(([savedFormat, savedOutputDir]) => {
      if (!alive) return
      if (savedFormat === 'mp4' || savedFormat === 'flv') setFormat(savedFormat)
      setOutputDir(savedOutputDir)
    }).catch(() => {})
    return () => {
      alive = false
    }
  }, [defaultOutputDir])

  const changeFormat = (value: ConvertOutputFormat): void => {
    setFormat(value)
    void kvSet('convert', 'format', value).catch(() => {})
  }

  const changeOutputDir = (value: string): void => {
    setOutputDir(value)
    void kvSet('convert', 'outputDir', value).catch(() => {})
  }

  const addFiles = async (paths: string[]): Promise<void> => {
    const fresh = paths.filter((filePath) => {
      const key = filePath.toLowerCase()
      if (!filePath || known.current.has(key)) return false
      known.current.add(key)
      return true
    })
    if (!fresh.length) return

    setItems((previous) => [...previous, ...fresh.map((filePath) => ({ path: filePath }))])
    const probed = await Promise.all(
      fresh.map(async (filePath) => {
        try {
          const info = await invokeSilent<MediaInfo>('core:probe', { path: filePath })
          return { path: filePath, info }
        } catch {
          return { path: filePath, error: true }
        }
      })
    )
    const byPath = new Map(probed.map((item) => [item.path, item]))
    setItems((previous) => previous.map((item) => byPath.get(item.path) ?? item))
  }

  const removeItem = (filePath: string): void => {
    known.current.delete(filePath.toLowerCase())
    setItems((previous) => previous.filter((item) => item.path !== filePath))
  }

  const clearAll = (): void => {
    known.current.clear()
    setItems([])
  }

  const run = async (): Promise<void> => {
    if (!items.length || busy) return
    setBusy(true)
    try {
      const payload: ConvertStartPayload = {
        inputs: items.map((item) => item.path),
        format,
        outputDir
      }
      const result = await invoke<ConvertStartResult>('mod:convert:start', payload)

      pushToast(
        'success',
        t(
          `Đã thêm ${result.taskIds.length} video vào hàng đợi chuyển sang ${format.toUpperCase()}`,
          `Queued ${result.taskIds.length} video(s) for ${format.toUpperCase()} conversion`
        )
      )
      if (result.skipped.length) {
        pushToast(
          'error',
          t(
            `${result.skipped.length} file không đọc được, đã bỏ qua`,
            `${result.skipped.length} unreadable file(s) skipped`
          )
        )
      }
    } catch {
      // invoke() đã hiển thị lỗi cho người dùng.
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <div className="page-title">{t('Chuyển đổi định dạng Video', 'Video Format Converter')}</div>
      <div className="page-desc">
        {t(
          'Chuyển đổi hàng loạt video sang MP4 hoặc FLV. Mỗi video là một tác vụ riêng và được xử lý song song.',
          'Batch-convert videos to MP4 or FLV. Each video is an independent task processed in parallel.'
        )}
      </div>

      <div className="card">
        <div className="card-title">
          {t('Video nguồn', 'Source videos')} <span className="badge">{items.length}</span>
          {items.length > 0 && (
            <span className="right">
              <button className="btn btn-sm btn-danger" onClick={clearAll}>
                {t('Xóa hết', 'Clear all')}
              </button>
            </span>
          )}
        </div>

        {items.length > 0 && (
          <div className="table-wrap mb" style={{ maxHeight: 300 }}>
            <table className="table">
              <thead>
                <tr>
                  <th>{t('Tên file', 'File name')}</th>
                  <th>{t('Định dạng', 'Format')}</th>
                  <th>{t('Codec', 'Codec')}</th>
                  <th>{t('Thời lượng', 'Duration')}</th>
                  <th>{t('Độ phân giải', 'Resolution')}</th>
                  <th>{t('Dung lượng', 'Size')}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.path}>
                    <td className="ellipsis" style={{ maxWidth: 300 }} title={item.path}>
                      🎬 {baseName(item.path)}
                    </td>
                    <td>{sourceFormat(item.path)}</td>
                    <td>{item.info?.video?.codec.toUpperCase() ?? ''}</td>
                    <td className="mono">
                      {item.info ? secToHms(item.info.durationSec) : item.error ? '—' : '…'}
                    </td>
                    <td className="mono">
                      {item.info?.video
                        ? `${item.info.video.width}×${item.info.video.height}`
                        : item.error
                          ? t('Lỗi đọc file', 'Unreadable')
                          : ''}
                    </td>
                    <td className="text-dim">{item.info ? fmtBytes(item.info.sizeBytes) : ''}</td>
                    <td style={{ textAlign: 'right' }}>
                      <button
                        className="btn btn-sm btn-ghost"
                        title={t('Xóa khỏi danh sách', 'Remove from list')}
                        aria-label={t('Xóa khỏi danh sách', 'Remove from list')}
                        onClick={() => removeItem(item.path)}
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
          allowFolder
          accept={VIDEO_FILTER}
          onFiles={(paths) => void addFiles(paths)}
        />
      </div>

      <div className="card">
        <div className="card-title">{t('Đầu ra', 'Output')}</div>
        <div className="grid-2">
          <Field
            label={t('Định dạng đầu ra', 'Output format')}
            hint={t(
              'MP4 và FLV đều dùng video H.264 cùng âm thanh AAC để tương thích rộng.',
              'Both MP4 and FLV use H.264 video with AAC audio for broad compatibility.'
            )}
          >
            <Select<ConvertOutputFormat>
              value={format}
              onChange={changeFormat}
              options={[
                { value: 'mp4', label: 'MP4' },
                { value: 'flv', label: 'FLV' }
              ]}
            />
          </Field>
          <Field
            label={t('Thư mục xuất', 'Output folder')}
            hint={t(
              'Để trống sẽ lưu cạnh từng video nguồn. Lựa chọn được ghi nhớ cho lần mở sau.',
              'Leave empty to save next to each source video. This choice is remembered.'
            )}
          >
            <FolderInput
              value={outputDir}
              onChange={changeOutputDir}
              placeholder={t('Cùng thư mục với video nguồn', 'Next to each source video')}
            />
          </Field>
        </div>
        <div className="row wrap">
          <button
            className="btn btn-primary"
            disabled={!items.length || busy}
            onClick={() => void run()}
          >
            {busy
              ? t('Đang chuẩn bị...', 'Preparing...')
              : t(`Chuyển sang ${format.toUpperCase()}`, `Convert to ${format.toUpperCase()}`)}
          </button>
          <span className="hint">
            {t(
              `Tối đa ${parallelTasks} tác vụ FFmpeg song song trên toàn ứng dụng · Giữ nguyên file nguồn · Đầu ra: *_converted.${format}`,
              `Up to ${parallelTasks} parallel FFmpeg tasks app-wide · Sources are preserved · Output: *_converted.${format}`
            )}
          </span>
        </div>
      </div>

      <TaskTable types={['convert']} />
    </div>
  )
}
