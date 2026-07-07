import { memo, useEffect, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { fmtElapsed } from '@shared/time'
import { cancelTask, clearFinishedTasks, showInFolder } from '../api'
import { useT } from '../i18n'
import { useTask, useTaskIdsByTypes } from '../store/tasks'
import { LogModal } from './LogModal'
import { ProgressBar } from './ProgressBar'
import { StatusChip } from './StatusChip'

/** Đồng hồ thời gian đã chạy — chỉ re-render row đang chạy, 1s/lần */
function Elapsed({ startedAt, finishedAt }: { startedAt?: number; finishedAt?: number }): React.JSX.Element {
  const [, force] = useState(0)
  const running = !!startedAt && !finishedAt
  useEffect(() => {
    if (!running) return
    const iv = setInterval(() => force((n) => n + 1), 1000)
    return () => clearInterval(iv)
  }, [running])
  if (!startedAt) return <span className="text-faint">—</span>
  return <span className="mono">{fmtElapsed((finishedAt ?? Date.now()) - startedAt)}</span>
}

const Row = memo(function Row({ id, onLog }: { id: string; onLog: (id: string) => void }): React.JSX.Element | null {
  const t = useT()
  const task = useTask(id)
  if (!task) return null
  const active = task.status === 'running' || task.status === 'queued'
  return (
    <tr>
      <td className="ellipsis" title={task.title} style={{ maxWidth: 260 }}>
        {task.title}
        {task.error && (
          <div className="text-danger" style={{ fontSize: 11 }} title={task.error}>
            {task.error.slice(0, 120)}
          </div>
        )}
      </td>
      <td>
        <StatusChip status={task.status} />
      </td>
      <td style={{ width: 190 }}>
        <ProgressBar value={task.status === 'completed' ? 100 : task.progress} />
      </td>
      <td className="mono text-dim" style={{ fontSize: 11.5 }}>
        {[task.speed, task.eta && `ETA ${task.eta}`, task.detail].filter(Boolean).join(' · ') || '—'}
      </td>
      <td>
        <Elapsed startedAt={task.startedAt} finishedAt={task.finishedAt} />
      </td>
      <td>
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          {active && (
            <button className="btn btn-sm btn-danger" onClick={() => void cancelTask(id)}>
              {t('Dừng', 'Stop')}
            </button>
          )}
          <button className="btn btn-sm btn-ghost" title={t('Xem log', 'View log')} onClick={() => onLog(id)}>
            📄
          </button>
          {task.outputPath && task.status === 'completed' && (
            <button
              className="btn btn-sm btn-ghost"
              title={t('Mở thư mục', 'Show in folder')}
              onClick={() => void showInFolder(task.outputPath!)}
            >
              📂
            </button>
          )}
        </div>
      </td>
    </tr>
  )
})

/**
 * Bảng tác vụ dùng chung cho mọi module: lọc theo type, virtual scroll khi >50 dòng.
 *   <TaskTable types={['render']} />
 */
export function TaskTable({ types, title }: { types: string[]; title?: string }): React.JSX.Element {
  const t = useT()
  const ids = useTaskIdsByTypes(types)
  const [logId, setLogId] = useState<string | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const useVirtual = ids.length > 50

  const virtualizer = useVirtualizer({
    count: useVirtual ? ids.length : 0,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 44,
    overscan: 10
  })

  const header = (
    <thead>
      <tr>
        <th>{t('Tác vụ', 'Task')}</th>
        <th>{t('Trạng thái', 'Status')}</th>
        <th>{t('Tiến trình', 'Progress')}</th>
        <th>{t('Tốc độ', 'Speed')}</th>
        <th>{t('Thời gian', 'Elapsed')}</th>
        <th style={{ textAlign: 'right' }}>{t('Hành động', 'Actions')}</th>
      </tr>
    </thead>
  )

  return (
    <div className="card">
      <div className="card-title">
        {title ?? t('Hàng đợi tác vụ', 'Task queue')} <span className="badge">{ids.length}</span>
        <span className="right">
          <button className="btn btn-sm btn-ghost" onClick={() => void clearFinishedTasks(types)}>
            {t('Xoá đã xong', 'Clear finished')}
          </button>
        </span>
      </div>
      {ids.length === 0 ? (
        <div className="empty-state">
          <div className="big">🗂️</div>
          {t('Chưa có tác vụ nào', 'No tasks yet')}
        </div>
      ) : (
        <div className="table-wrap" ref={scrollRef} style={{ maxHeight: 420 }}>
          <table className="table">
            {header}
            {useVirtual ? (
              <tbody style={{ position: 'relative' }}>
                {virtualizer.getVirtualItems().length > 0 && (
                  <tr style={{ height: virtualizer.getVirtualItems()[0].start }} aria-hidden />
                )}
                {virtualizer.getVirtualItems().map((v) => (
                  <Row key={ids[v.index]} id={ids[v.index]} onLog={setLogId} />
                ))}
                <tr
                  style={{
                    height:
                      virtualizer.getTotalSize() -
                      (virtualizer.getVirtualItems().at(-1)?.end ?? 0)
                  }}
                  aria-hidden
                />
              </tbody>
            ) : (
              <tbody>
                {ids.map((id) => (
                  <Row key={id} id={id} onLog={setLogId} />
                ))}
              </tbody>
            )}
          </table>
        </div>
      )}
      {logId && <LogModal taskId={logId} onClose={() => setLogId(null)} />}
    </div>
  )
}
