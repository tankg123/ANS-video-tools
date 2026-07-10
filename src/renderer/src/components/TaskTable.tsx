import { memo, useEffect, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { useShallow } from 'zustand/react/shallow'
import { fmtElapsed } from '@shared/time'
import { cancelTask, clearFinishedTasks, showInFolder } from '../api'
import { useT } from '../i18n'
import { useTask, useTaskIdsByTypes, useTasks } from '../store/tasks'
import { Icon } from './Icon'
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

const Row = memo(function Row({
  id,
  onLog,
  virtualIndex,
  measureRef
}: {
  id: string
  onLog: (id: string) => void
  virtualIndex?: number
  measureRef?: (node: HTMLTableRowElement | null) => void
}): React.JSX.Element | null {
  const t = useT()
  const task = useTask(id)
  if (!task) return null
  const active = task.status === 'running' || task.status === 'queued'
  return (
    <tr
      ref={measureRef}
      data-index={virtualIndex}
      className={`task-row ${task.status}`}
    >
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
        {/* killed/error mà progress indeterminate (-1) → 0, tránh animation chạy mãi */}
        <ProgressBar
          value={
            task.status === 'completed'
              ? 100
              : (task.status === 'killed' || task.status === 'error') && task.progress < 0
                ? 0
                : task.progress
          }
        />
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
            <button className="btn btn-sm btn-stop" onClick={() => void cancelTask(id)}>
              <Icon name="stop" size={14} />
              {t('Dừng', 'Stop')}
            </button>
          )}
          <button className="btn btn-sm btn-icon btn-ghost" aria-label={t('Xem log', 'View log')} title={t('Xem log', 'View log')} onClick={() => onLog(id)}>
            <Icon name="file-text" size={15} />
          </button>
          {task.outputPath && task.status === 'completed' && (
            <button
              className="btn btn-sm btn-icon btn-ghost"
              aria-label={t('Mở thư mục', 'Show in folder')}
              title={t('Mở thư mục', 'Show in folder')}
              onClick={() => void showInFolder(task.outputPath!)}
            >
              <Icon name="folder" size={15} />
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
  const summary = useTasks(
    useShallow((state) => {
      let running = 0
      let queued = 0
      let finished = 0
      let errors = 0
      for (const id of ids) {
        const task = state.byId[id]
        if (!task) continue
        if (task.status === 'running') running++
        else if (task.status === 'queued') queued++
        else finished++
        if (task.status === 'error') errors++
      }
      return { running, queued, finished, errors }
    })
  )
  const [logId, setLogId] = useState<string | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const useVirtual = ids.length > 50

  const virtualizer = useVirtualizer({
    count: useVirtual ? ids.length : 0,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 52,
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
        <span className="card-title-icon"><Icon name="activity" size={16} /></span>
        {title ?? t('Hàng đợi tác vụ', 'Task queue')} <span className="badge">{ids.length}</span>
        <span className="task-summary">
          {summary.running > 0 && <span className="running">{summary.running} {t('đang chạy', 'running')}</span>}
          {summary.queued > 0 && <span>{summary.queued} {t('đang chờ', 'queued')}</span>}
          {summary.errors > 0 && <span className="error">{summary.errors} {t('lỗi', 'errors')}</span>}
        </span>
        <span className="right">
          <button className="btn btn-sm btn-ghost" disabled={summary.finished === 0} onClick={() => void clearFinishedTasks(types)}>
            <Icon name="trash" size={14} />
            {t('Xoá đã xong', 'Clear finished')}
          </button>
        </span>
      </div>
      {ids.length === 0 ? (
        <div className="empty-state">
          <div className="empty-icon"><Icon name="inbox" size={28} /></div>
          <strong>{t('Chưa có tác vụ', 'No tasks yet')}</strong>
          <span>{t('Tác vụ mới sẽ xuất hiện tại đây để bạn theo dõi.', 'New jobs will appear here with live progress.')}</span>
        </div>
      ) : (
        <div className="table-wrap" ref={scrollRef} style={{ maxHeight: 420 }}>
          <table className="table">
            {header}
            {useVirtual ? (
              <tbody style={{ position: 'relative' }}>
                {virtualizer.getVirtualItems().length > 0 && (
                  <tr aria-hidden><td colSpan={6} style={{ height: virtualizer.getVirtualItems()[0].start, padding: 0 }} /></tr>
                )}
                {virtualizer.getVirtualItems().map((v) => (
                  <Row
                    key={ids[v.index]}
                    id={ids[v.index]}
                    onLog={setLogId}
                    virtualIndex={v.index}
                    measureRef={virtualizer.measureElement}
                  />
                ))}
                <tr aria-hidden>
                  <td
                    colSpan={6}
                    style={{
                      height:
                        virtualizer.getTotalSize() -
                        (virtualizer.getVirtualItems().at(-1)?.end ?? 0),
                      padding: 0
                    }}
                  />
                </tr>
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
