import { useEffect, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import type { SuperLiveStream } from '@shared/modules/super-live'
import { fmtElapsed } from '@shared/time'
import { invoke, pickFiles, pickFolder } from '../../api'
import { Check, Field, NumInput, Select } from '../../components/Field'
import { Modal } from '../../components/Modal'
import { StatusChip } from '../../components/StatusChip'
import { TaskTable } from '../../components/TaskTable'
import { useT } from '../../i18n'
import { useSettings } from '../../store/settings'
import { useTask, useTasks } from '../../store/tasks'
import { useUi } from '../../store/ui'

// ---------- helpers ----------

const baseName = (p: string): string => p.split(/[\\/]/).filter(Boolean).pop() ?? p

const blankStream = (): SuperLiveStream => ({
  id: crypto.randomUUID(),
  name: '',
  source: '',
  isFolder: false,
  rtmpUrl: '',
  streamKey: '',
  loop: true,
  shuffle: false,
  encoder: 'copy',
  bitrate: 4000,
  resolution: ''
})

/** ISO -> giá trị input datetime-local (giờ địa phương) */
function isoToLocal(iso?: string): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}

function localToIso(v: string): string | undefined {
  if (!v) return undefined
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString()
}

/** Đồng hồ đã phát — chỉ re-render dòng đang chạy, 1s/lần */
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

// ---------- form modal ----------

function StreamModal({
  initial,
  onSave,
  onClose
}: {
  initial: SuperLiveStream
  onSave: (s: SuperLiveStream) => void
  onClose: () => void
}): React.JSX.Element {
  const t = useT()
  const [d, setD] = useState<SuperLiveStream>(initial)
  const patch = (p: Partial<SuperLiveStream>): void => setD((prev) => ({ ...prev, ...p }))

  const copyForced = d.encoder === 'copy' && !!d.resolution
  const reEncode = d.encoder !== 'copy' || !!d.resolution
  const valid = !!d.source.trim() && !!d.rtmpUrl.trim()

  return (
    <Modal
      wide
      title={t('Cấu hình luồng live', 'Live stream settings')}
      onClose={onClose}
      actions={
        <>
          <button className="btn" onClick={onClose}>
            {t('Huỷ', 'Cancel')}
          </button>
          <button
            className="btn btn-primary"
            disabled={!valid}
            onClick={() => onSave({ ...d, name: d.name.trim() || baseName(d.source) })}
          >
            {t('Lưu luồng', 'Save stream')}
          </button>
        </>
      }
    >
      <Field label={t('Tên luồng', 'Stream name')}>
        <input
          className="input"
          value={d.name}
          placeholder={t('VD: Kênh YouTube chính', 'e.g. Main YouTube channel')}
          onChange={(e) => patch({ name: e.target.value })}
        />
      </Field>

      <Field label={t('Nguồn video (file hoặc thư mục)', 'Video source (file or folder)')}>
        <div className="input-row">
          <input
            className="input"
            value={d.source}
            placeholder={t('Đường dẫn file/thư mục video...', 'Video file/folder path...')}
            onChange={(e) => patch({ source: e.target.value })}
          />
          <button
            className="btn"
            onClick={async () => {
              const ps = await pickFiles({ multi: false })
              if (ps[0]) patch({ source: ps[0], isFolder: false })
            }}
          >
            {t('Chọn file', 'File...')}
          </button>
          <button
            className="btn"
            onClick={async () => {
              const dir = await pickFolder()
              if (dir) patch({ source: dir, isFolder: true })
            }}
          >
            {t('Thư mục', 'Folder...')}
          </button>
        </div>
      </Field>

      <div className="grid-2">
        <Field label="RTMP URL">
          <input
            className="input mono"
            value={d.rtmpUrl}
            placeholder="rtmp://a.rtmp.youtube.com/live2"
            onChange={(e) => patch({ rtmpUrl: e.target.value })}
          />
        </Field>
        <Field label={t('Stream Key', 'Stream key')}>
          <input
            className="input mono"
            value={d.streamKey}
            placeholder={t('Khoá luồng (nếu chưa gộp vào URL)', 'Stream key (if not in URL)')}
            onChange={(e) => patch({ streamKey: e.target.value })}
          />
        </Field>
      </div>

      <div className="row wrap">
        <Check checked={d.loop} onChange={(v) => patch({ loop: v })} label={t('Lặp vô hạn', 'Loop forever')} />
        <Check
          checked={d.shuffle}
          onChange={(v) => patch({ shuffle: v })}
          disabled={!d.isFolder}
          label={t('Phát ngẫu nhiên (chỉ với thư mục)', 'Shuffle (folder only)')}
        />
      </div>

      <div className="grid-3 mt">
        <Field label={t('Encoder', 'Encoder')}>
          <Select
            value={d.encoder}
            onChange={(v) => patch({ encoder: v })}
            options={[
              { value: 'copy', label: t('Copy (CPU ~0%)', 'Copy (CPU ~0%)') },
              { value: 'x264', label: 'x264 (CPU)' },
              { value: 'hw', label: t('GPU tự động (NVENC/QSV/AMF)', 'Auto GPU (NVENC/QSV/AMF)') }
            ]}
          />
        </Field>
        <Field label={t('Bitrate video (kbps)', 'Video bitrate (kbps)')}>
          <NumInput value={d.bitrate} onChange={(v) => patch({ bitrate: v })} min={200} max={50000} step={500} disabled={!reEncode} />
        </Field>
        <Field label={t('Độ phân giải', 'Resolution')}>
          <Select
            value={d.resolution}
            onChange={(v) => patch({ resolution: v })}
            options={[
              { value: '', label: t('Giữ nguyên', 'Keep original') },
              { value: '1080', label: '1080p' },
              { value: '720', label: '720p' },
              { value: '480', label: '480p' }
            ]}
          />
        </Field>
      </div>
      {copyForced && (
        <div className="hint">
          {t(
            '⚠ Đổi độ phân giải buộc phải re-encode — luồng này sẽ dùng x264 thay vì copy.',
            '⚠ Changing resolution forces re-encode — this stream will use x264 instead of copy.'
          )}
        </div>
      )}
      {d.encoder === 'copy' && !d.resolution && (
        <div className="hint">
          {t(
            'Copy yêu cầu nguồn H264+AAC — nếu không đúng chuẩn sẽ tự chuyển sang x264.',
            'Copy requires H264+AAC source — otherwise x264 is used automatically.'
          )}
        </div>
      )}

      <div className="grid-2 mt">
        <Field label={t('Hẹn giờ bắt đầu (tuỳ chọn)', 'Schedule start (optional)')}>
          <input
            type="datetime-local"
            className="input"
            value={isoToLocal(d.scheduleStart)}
            onChange={(e) => patch({ scheduleStart: localToIso(e.target.value) })}
          />
        </Field>
        <Field label={t('Hẹn giờ kết thúc (tuỳ chọn)', 'Schedule end (optional)')}>
          <input
            type="datetime-local"
            className="input"
            value={isoToLocal(d.scheduleEnd)}
            onChange={(e) => patch({ scheduleEnd: localToIso(e.target.value) })}
          />
        </Field>
      </div>
    </Modal>
  )
}

// ---------- table row ----------

function StreamRow({
  stream,
  taskId,
  onStart,
  onStop,
  onEdit,
  onDelete
}: {
  stream: SuperLiveStream
  taskId?: string
  onStart: () => void
  onStop: () => void
  onEdit: () => void
  onDelete: () => void
}): React.JSX.Element {
  const t = useT()
  const task = useTask(taskId ?? '')
  const active = !!task && (task.status === 'running' || task.status === 'queued')
  const waiting = active && task?.meta?.waiting === true
  const mode =
    (task?.meta?.mode as string | undefined) ??
    (stream.encoder === 'copy' && !stream.resolution ? 'copy' : 're-encode')

  return (
    <tr>
      <td className="ellipsis" style={{ maxWidth: 220 }} title={stream.source}>
        <div>{stream.name || baseName(stream.source)}</div>
        <div className="text-dim" style={{ fontSize: 11 }}>
          {stream.isFolder ? '📁' : '🎬'} {baseName(stream.source)}
          {stream.loop ? ' · ∞' : ''}
          {stream.isFolder && stream.shuffle ? ' · 🔀' : ''}
        </div>
      </td>
      <td className="ellipsis" style={{ maxWidth: 200 }} title={stream.rtmpUrl}>
        <div className="mono" style={{ fontSize: 11.5 }}>
          {stream.rtmpUrl || '—'}
          {stream.streamKey ? '/••••' : ''}
        </div>
        <span className="badge">{mode === 'copy' ? 'copy' : 're-encode'}</span>
      </td>
      <td>
        {waiting ? (
          <span className="chip queued">⏰ {t('Đã hẹn giờ', 'Scheduled')}</span>
        ) : task ? (
          <StatusChip status={task.status} />
        ) : (
          <span className="chip">{t('Chưa chạy', 'Idle')}</span>
        )}
        {task?.detail && !waiting && (
          <div className="text-dim mono" style={{ fontSize: 10.5 }}>
            {task.detail}
          </div>
        )}
        {task?.error && (
          <div className="text-danger" style={{ fontSize: 10.5 }} title={task.error}>
            {task.error.slice(0, 80)}
          </div>
        )}
      </td>
      <td>
        {/* Đang chờ đến giờ hẹn → chưa phát, không chạy đồng hồ */}
        {waiting ? (
          <span className="text-faint">—</span>
        ) : (
          <Elapsed startedAt={task?.startedAt} finishedAt={task?.finishedAt} />
        )}
      </td>
      <td>
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          {active ? (
            <button className="btn btn-sm btn-danger" onClick={onStop}>
              ⏹ {t('Dừng', 'Stop')}
            </button>
          ) : (
            <button className="btn btn-sm btn-success" onClick={onStart}>
              ▶ {t('Phát', 'Start')}
            </button>
          )}
          <button className="btn btn-sm btn-ghost" disabled={active} title={t('Sửa', 'Edit')} onClick={onEdit}>
            ✏️
          </button>
          <button className="btn btn-sm btn-ghost" disabled={active} title={t('Xoá', 'Delete')} onClick={onDelete}>
            🗑️
          </button>
        </div>
      </td>
    </tr>
  )
}

// ---------- page ----------

export default function SuperLive(): React.JSX.Element {
  const t = useT()
  const pushToast = useUi((s) => s.pushToast)
  const maxLive = useSettings((s) => s.settings?.maxLive ?? 5)

  const [streams, setStreams] = useState<SuperLiveStream[]>([])
  const [editing, setEditing] = useState<SuperLiveStream | null>(null)
  const [showTasks, setShowTasks] = useState(false)

  useEffect(() => {
    void invoke<SuperLiveStream[]>('mod:super-live:list').then((s) => setStreams(s ?? []))
  }, [])

  /** streamId -> "taskId|1/0" (task mới nhất, cờ active) — chuỗi để shallow-compare ổn định */
  const rowInfo = useTasks(
    useShallow((s) => {
      const m: Record<string, string> = {}
      for (const id of s.order) {
        const tk = s.byId[id]
        if (tk?.type === 'super-live') {
          const sid = tk.meta?.streamId
          if (typeof sid === 'string') {
            const act = tk.status === 'running' || tk.status === 'queued'
            m[sid] = `${id}|${act ? '1' : '0'}`
          }
        }
      }
      return m
    })
  )
  const taskIdOf = (streamId: string): string | undefined => rowInfo[streamId]?.split('|')[0]
  const isActive = (streamId: string): boolean => rowInfo[streamId]?.endsWith('|1') ?? false
  const activeCount = streams.filter((s) => isActive(s.id)).length

  const persist = (next: SuperLiveStream[]): void => {
    setStreams(next)
    void invoke('mod:super-live:save', next)
  }

  const startOne = async (id: string): Promise<void> => {
    try {
      await invoke<string>('mod:super-live:start', { id })
    } catch {
      /* toast lỗi đã hiện trong invoke */
    }
  }
  const stopOne = (id: string): void => {
    void invoke('mod:super-live:stop', { id })
  }
  const startAll = async (): Promise<void> => {
    for (const s of streams) {
      if (!isActive(s.id)) await startOne(s.id)
    }
  }
  const stopAll = (): void => {
    for (const s of streams) {
      if (isActive(s.id)) stopOne(s.id)
    }
  }

  const saveStream = (s: SuperLiveStream): void => {
    const idx = streams.findIndex((x) => x.id === s.id)
    const next = idx >= 0 ? streams.map((x) => (x.id === s.id ? s : x)) : [...streams, s]
    persist(next)
    setEditing(null)
    pushToast('success', t('Đã lưu cấu hình luồng', 'Stream saved'))
  }

  const deleteStream = (id: string): void => {
    if (isActive(id)) {
      pushToast('error', t('Hãy dừng luồng trước khi xoá', 'Stop the stream before deleting'))
      return
    }
    persist(streams.filter((x) => x.id !== id))
  }

  return (
    <div>
      <div className="page-title">{t('Super Live Stream', 'Super Live Stream')}</div>
      <div className="page-desc">
        {t(
          `Phát nhiều luồng RTMP song song từ file hoặc thư mục video (tối đa ${maxLive} luồng — chỉnh trong Cài đặt). Chế độ copy với nguồn H264+AAC: CPU ~0%. Tự kết nối lại khi rớt mạng.`,
          `Stream multiple RTMP feeds in parallel from video files or folders (max ${maxLive} concurrent — see Settings). Copy mode with H264+AAC sources: ~0% CPU. Auto-reconnects on network drops.`
        )}
      </div>

      <div className="card">
        <div className="card-title">
          {t('Danh sách luồng', 'Streams')} <span className="badge">{streams.length}</span>
          {activeCount > 0 && (
            <span className="badge">{t(`${activeCount} đang phát`, `${activeCount} live`)}</span>
          )}
          <span className="right">
            <span className="row">
              <button className="btn btn-sm btn-success" disabled={!streams.length} onClick={() => void startAll()}>
                ▶ {t('Start tất cả', 'Start all')}
              </button>
              <button className="btn btn-sm btn-danger" disabled={activeCount === 0} onClick={stopAll}>
                ⏹ {t('Stop tất cả', 'Stop all')}
              </button>
              <button className="btn btn-sm btn-primary" onClick={() => setEditing(blankStream())}>
                ＋ {t('Thêm luồng', 'Add stream')}
              </button>
            </span>
          </span>
        </div>

        {streams.length === 0 ? (
          <div className="empty-state">
            <div className="big">📡</div>
            {t('Chưa có luồng nào — bấm "+ Thêm luồng" để bắt đầu', 'No streams yet — click "+ Add stream" to begin')}
          </div>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>{t('Luồng / Nguồn', 'Stream / Source')}</th>
                  <th>{t('Đích RTMP', 'RTMP destination')}</th>
                  <th>{t('Trạng thái', 'Status')}</th>
                  <th>{t('Đã phát', 'On air')}</th>
                  <th style={{ textAlign: 'right' }}>{t('Hành động', 'Actions')}</th>
                </tr>
              </thead>
              <tbody>
                {streams.map((s) => (
                  <StreamRow
                    key={s.id}
                    stream={s}
                    taskId={taskIdOf(s.id)}
                    onStart={() => void startOne(s.id)}
                    onStop={() => stopOne(s.id)}
                    onEdit={() => setEditing(s)}
                    onDelete={() => deleteStream(s.id)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="row mb">
        <button className="btn btn-sm btn-ghost" onClick={() => setShowTasks((v) => !v)}>
          {showTasks ? '▾' : '▸'} {t('Nhật ký tác vụ (log)', 'Task log')}
        </button>
      </div>
      {showTasks && <TaskTable types={['super-live']} title={t('Tác vụ live', 'Live tasks')} />}

      {editing && (
        <StreamModal initial={editing} onSave={saveStream} onClose={() => setEditing(null)} />
      )}
    </div>
  )
}
