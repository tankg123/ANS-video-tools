import { useCallback, useMemo, useState } from 'react'
import { pathForFile, pickFiles, pickFolder, scanDir, statPath } from '../api'
import { useT } from '../i18n'
import { useUi } from '../store/ui'
import { Icon } from './Icon'

/** Vùng nhập media dùng chung: kéo-thả, chọn file hoặc quét một thư mục video. */
export function FileDrop({
  onFiles,
  multi = true,
  allowFolder = true,
  accept,
  hint
}: {
  onFiles: (paths: string[]) => void
  multi?: boolean
  allowFolder?: boolean
  accept?: { name: string; extensions: string[] }[]
  hint?: string
}): React.JSX.Element {
  const t = useT()
  const pushToast = useUi((s) => s.pushToast)
  const [over, setOver] = useState(false)
  const allowedExtensions = useMemo(
    () => new Set((accept ?? []).flatMap((filter) => filter.extensions.map((ext) => `.${ext.toLowerCase()}`))),
    [accept]
  )

  const filterAccepted = useCallback(
    (paths: string[]): string[] => {
      if (!allowedExtensions.size) return paths
      return paths.filter((item) => {
        const dot = item.lastIndexOf('.')
        return dot >= 0 && allowedExtensions.has(item.slice(dot).toLowerCase())
      })
    },
    [allowedExtensions]
  )

  const commit = useCallback(
    (paths: string[], originalCount = paths.length): void => {
      const accepted = [...new Set(filterAccepted(paths))]
      const selected = multi ? accepted : accepted.slice(0, 1)
      if (selected.length) onFiles(selected)
      const rejected = Math.max(0, originalCount - accepted.length)
      if (rejected > 0) {
        pushToast(
          'info',
          t(
            `Đã bỏ qua ${rejected} file không đúng định dạng`,
            `Skipped ${rejected} unsupported file(s)`
          )
        )
      }
    },
    [filterAccepted, multi, onFiles, pushToast, t]
  )

  const browseFiles = useCallback(async (): Promise<void> => {
    const paths = await pickFiles({ multi, filters: accept })
    if (paths.length) commit(paths)
  }, [accept, commit, multi])

  const browseFolder = useCallback(async (): Promise<void> => {
    const dir = await pickFolder()
    if (!dir) return
    const files = await scanDir(dir)
    if (files.length) commit(files)
    else pushToast('info', t('Không tìm thấy video phù hợp trong thư mục', 'No supported videos found in this folder'))
  }, [commit, pushToast, t])

  const handleDrop = useCallback(
    async (event: React.DragEvent): Promise<void> => {
      event.preventDefault()
      setOver(false)
      const dropped = Array.from(event.dataTransfer.files)
      const groups = await Promise.all(
        dropped.map(async (file): Promise<string[]> => {
          const itemPath = pathForFile(file)
          if (!itemPath) return []
          const stat = await statPath(itemPath)
          if (stat.isDirectory) return allowFolder ? scanDir(itemPath) : []
          return stat.exists ? [itemPath] : []
        })
      )
      commit(groups.flat(), dropped.length)
    },
    [allowFolder, commit]
  )

  return (
    <div
      className={`dropzone${over ? ' over' : ''}`}
      onDragOver={(event) => {
        event.preventDefault()
        setOver(true)
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOver(false)
      }}
      onDrop={(event) => void handleDrop(event)}
    >
      <span className="dropzone-icon"><Icon name="upload" size={28} /></span>
      <div className="dropzone-copy">
        <strong>{t('Thả media vào không gian này', 'Drop media into this workspace')}</strong>
        <span>
          {hint ??
            t(
              'Kéo file hoặc thư mục vào đây; hệ thống sẽ tự lọc định dạng phù hợp.',
              'Drop files or folders here; supported formats are filtered automatically.'
            )}
        </span>
      </div>
      <div className="dropzone-actions">
        <button className="btn btn-primary btn-sm" onClick={() => void browseFiles()}>
          <Icon name="file-text" size={15} />
          {multi ? t('Chọn file', 'Choose files') : t('Chọn một file', 'Choose a file')}
        </button>
        {allowFolder && (
          <button className="btn btn-sm" onClick={() => void browseFolder()}>
            <Icon name="folder" size={15} />
            {t('Chọn thư mục', 'Choose folder')}
          </button>
        )}
      </div>
    </div>
  )
}
