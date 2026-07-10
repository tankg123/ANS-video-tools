import { useEffect, useRef, useState } from 'react'
import type { MediaInfo } from '@shared/types'
import type {
  RemoveAudioStartPayload,
  RemoveAudioStartResult
} from '@shared/modules/remove-audio'
import { fmtBytes, secToHms } from '@shared/time'
import { invoke, invokeSilent, kvGet, kvSet } from '../../api'
import { Field, FolderInput } from '../../components/Field'
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

const baseName = (p: string): string => p.split(/[\\/]/).pop() ?? p

/** Batch-remove all audio streams while copying the video stream unchanged. */
export default function RemoveAudio(): React.JSX.Element {
  const t = useT()
  const pushToast = useUi((s) => s.pushToast)
  const settings = useSettings((s) => s.settings)
  const defaultOutputDir = settings?.outputDir ?? ''
  const cpuCap = Math.max(1, Math.floor((navigator.hardwareConcurrency || 2) / 2))
  const parallelTasks = Math.min(settings?.maxFfmpeg ?? 1, cpuCap)

  const [items, setItems] = useState<Item[]>([])
  const [outputDir, setOutputDir] = useState(defaultOutputDir)
  const [busy, setBusy] = useState(false)
  const known = useRef<Set<string>>(new Set())

  useEffect(() => {
    let alive = true
    void kvGet<string>('remove-audio', 'outputDir', defaultOutputDir).then((saved) => {
      if (alive) setOutputDir(saved)
    })
    return () => {
      alive = false
    }
  }, [defaultOutputDir])

  const changeOutputDir = (value: string): void => {
    setOutputDir(value)
    void kvSet('remove-audio', 'outputDir', value)
  }

  const addFiles = async (paths: string[]): Promise<void> => {
    const fresh = paths.filter((p) => {
      const key = p.toLowerCase()
      if (!p || known.current.has(key)) return false
      known.current.add(key)
      return true
    })
    if (!fresh.length) return

    setItems((prev) => [...prev, ...fresh.map((p) => ({ path: p }))])
    await Promise.all(
      fresh.map(async (p) => {
        try {
          const info = await invokeSilent<MediaInfo>('core:probe', { path: p })
          setItems((prev) => prev.map((item) => (item.path === p ? { ...item, info } : item)))
        } catch {
          setItems((prev) =>
            prev.map((item) => (item.path === p ? { ...item, error: true } : item))
          )
        }
      })
    )
  }

  const removeItem = (p: string): void => {
    known.current.delete(p.toLowerCase())
    setItems((prev) => prev.filter((item) => item.path !== p))
  }

  const clearAll = (): void => {
    known.current.clear()
    setItems([])
  }

  const run = async (): Promise<void> => {
    if (!items.length || busy) return
    setBusy(true)
    try {
      const payload: RemoveAudioStartPayload = {
        inputs: items.map((item) => item.path),
        outputDir
      }
      const result = await invoke<RemoveAudioStartResult>('mod:remove-audio:start', payload)

      if (result.taskIds.length) {
        pushToast(
          'success',
          t(
            `Đã thêm ${result.taskIds.length} video vào hàng đợi xóa audio`,
            `Queued ${result.taskIds.length} video(s) for audio removal`
          )
        )
      }
      if (result.alreadySilent.length) {
        pushToast(
          'info',
          t(
            `${result.alreadySilent.length} video đã không có audio, đã bỏ qua`,
            `${result.alreadySilent.length} video(s) already had no audio and were skipped`
          )
        )
      }
      if (result.skipped.length) {
        pushToast(
          'error',
          t(
            `${result.skipped.length} file không đọc được, đã bỏ qua`,
            `${result.skipped.length} unreadable file(s) skipped`
          )
        )
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <div className="page-title">{t('Xóa Audio khỏi Video', 'Remove Audio from Video')}</div>
      <div className="page-desc">
        {t(
          'Xóa toàn bộ luồng âm thanh khỏi nhiều video cùng lúc. Video được stream-copy nên không giảm chất lượng và không cần re-encode.',
          'Remove every audio stream from multiple videos at once. Video is stream-copied, so quality is unchanged and no re-encoding is needed.'
        )}
      </div>

      <div className="card">
        <div className="card-title">
          {t('Danh sách video', 'Video list')} <span className="badge">{items.length}</span>
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
                  <th>{t('Thời lượng', 'Duration')}</th>
                  <th>{t('Video', 'Video')}</th>
                  <th>{t('Audio hiện tại', 'Current audio')}</th>
                  <th>{t('Dung lượng', 'Size')}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.path}>
                    <td className="ellipsis" style={{ maxWidth: 330 }} title={item.path}>
                      🎬 {baseName(item.path)}
                    </td>
                    <td className="mono">
                      {item.info
                        ? secToHms(item.info.durationSec)
                        : item.error
                          ? '—'
                          : '…'}
                    </td>
                    <td>{item.info?.video?.codec.toUpperCase() ?? ''}</td>
                    <td>
                      {item.info ? (
                        item.info.audio ? (
                          <span>{item.info.audio.codec.toUpperCase()}</span>
                        ) : (
                          <span className="text-faint">{t('Không có audio', 'No audio')}</span>
                        )
                      ) : item.error ? (
                        <span className="text-danger">{t('Lỗi đọc file', 'Unreadable')}</span>
                      ) : (
                        ''
                      )}
                    </td>
                    <td className="text-dim">{item.info ? fmtBytes(item.info.sizeBytes) : ''}</td>
                    <td style={{ textAlign: 'right' }}>
                      <button
                        className="btn btn-sm btn-ghost"
                        title={t('Xóa khỏi danh sách', 'Remove from list')}
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
        <div className="card-title">{t('Xử lý', 'Processing')}</div>
        <Field
          label={t('Thư mục xuất', 'Output folder')}
          hint={t(
            'Để trống sẽ lưu cạnh từng video nguồn. Lựa chọn này được ghi nhớ cho lần mở sau.',
            'Leave empty to save next to each source video. This choice is remembered next time.'
          )}
        >
          <FolderInput
            value={outputDir}
            onChange={changeOutputDir}
            placeholder={t('Cùng thư mục với video nguồn', 'Next to each source video')}
          />
        </Field>
        <div className="row wrap">
          <button
            className="btn btn-primary"
            disabled={!items.length || busy}
            onClick={() => void run()}
          >
            🔇 {busy ? t('Đang chuẩn bị...', 'Preparing...') : t('Bắt đầu xóa Audio', 'Remove Audio')}
          </button>
          <span className="hint">
            {t(
              `Chạy tối đa ${parallelTasks} tác vụ song song · File gốc được giữ nguyên · Đầu ra: *_no_audio`,
              `Up to ${parallelTasks} parallel tasks · Sources are preserved · Output: *_no_audio`
            )}
          </span>
        </div>
      </div>

      <TaskTable types={['remove-audio']} />
    </div>
  )
}
