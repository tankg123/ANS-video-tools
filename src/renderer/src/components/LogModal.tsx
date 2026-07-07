import { useEffect, useRef, useState } from 'react'
import { readLog } from '../api'
import { useT } from '../i18n'
import { useTask } from '../store/tasks'
import { Modal } from './Modal'

export function LogModal({ taskId, onClose }: { taskId: string; onClose: () => void }): React.JSX.Element {
  const t = useT()
  const [lines, setLines] = useState<string[]>([])
  const task = useTask(taskId)
  const running = task?.status === 'running'
  const boxRef = useRef<HTMLDivElement>(null)
  const stickBottom = useRef(true) // user đang ở gần đáy → mới auto-scroll

  useEffect(() => {
    let alive = true
    const load = async (): Promise<void> => {
      try {
        const l = await readLog(taskId)
        if (!alive) return
        // Đo vị trí TRƯỚC khi cập nhật nội dung
        const el = boxRef.current
        if (el) stickBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 10
        // Nội dung không đổi → giữ nguyên, khỏi re-render/scroll
        setLines((prev) =>
          prev.length === l.length && prev[prev.length - 1] === l[l.length - 1] ? prev : l
        )
      } catch {
        /* đã toast ở api */
      }
    }
    void load()
    const iv = running ? setInterval(load, 1000) : undefined
    return () => {
      alive = false
      if (iv) clearInterval(iv)
    }
  }, [taskId, running])

  useEffect(() => {
    const el = boxRef.current
    if (el && stickBottom.current) el.scrollTop = el.scrollHeight
  }, [lines])

  return (
    <Modal wide title={t('Nhật ký tác vụ', 'Task log')} onClose={onClose}>
      <div className="log-view" ref={boxRef}>
        {lines.length ? lines.join('\n') : t('(chưa có log)', '(no log yet)')}
      </div>
    </Modal>
  )
}
