import { useCallback, useState } from 'react'
import { pathForFile, pickFiles, pickFolder, scanDir, statPath } from '../api'
import { useT } from '../i18n'

/**
 * Vùng kéo-thả file/thư mục video + nút chọn file.
 * Thư mục sẽ được quét đệ quy lấy file video (main process).
 */
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
  /** filter cho dialog, vd [{name:'Ảnh', extensions:['png']}] */
  accept?: { name: string; extensions: string[] }[]
  hint?: string
}): React.JSX.Element {
  const t = useT()
  const [over, setOver] = useState(false)

  const handleDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault()
      setOver(false)
      const files = Array.from(e.dataTransfer.files)
      const out: string[] = []
      for (const f of files) {
        const p = pathForFile(f)
        if (!p) continue
        const st = await statPath(p)
        if (st.isDirectory && allowFolder) {
          out.push(...(await scanDir(p)))
        } else if (st.exists) {
          out.push(p)
        }
      }
      if (out.length) onFiles(multi ? out : out.slice(0, 1))
    },
    [onFiles, multi, allowFolder]
  )

  return (
    <div
      className={`dropzone${over ? ' over' : ''}`}
      onDragOver={(e) => {
        e.preventDefault()
        setOver(true)
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => void handleDrop(e)}
      onClick={async () => {
        const paths = await pickFiles({ multi, filters: accept })
        if (paths.length) onFiles(paths)
      }}
    >
      <div className="big">📥</div>
      <div>
        {hint ??
          t('Kéo-thả file/thư mục video vào đây, hoặc bấm để chọn file', 'Drag & drop video files/folders here, or click to browse')}
      </div>
      {allowFolder && (
        <div className="mt">
          <button
            className="btn btn-sm"
            onClick={async (e) => {
              e.stopPropagation()
              const dir = await pickFolder()
              if (dir) {
                const files = await scanDir(dir)
                if (files.length) onFiles(multi ? files : files.slice(0, 1))
              }
            }}
          >
            {t('Chọn thư mục', 'Choose folder')}
          </button>
        </div>
      )}
    </div>
  )
}
