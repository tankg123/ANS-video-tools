import type { TaskStatus } from '@shared/types'
import { useT } from '../i18n'

const LABELS: Record<TaskStatus, [string, string]> = {
  queued: ['Chờ', 'Queued'],
  running: ['Đang chạy', 'Running'],
  completed: ['Hoàn tất', 'Completed'],
  error: ['Lỗi', 'Error'],
  killed: ['Đã dừng', 'Stopped']
}

export function StatusChip({ status }: { status: TaskStatus }): React.JSX.Element {
  const t = useT()
  const [vi, en] = LABELS[status] ?? ['?', '?']
  return <span className={`chip ${status}`}><i />{t(vi, en)}</span>
}
