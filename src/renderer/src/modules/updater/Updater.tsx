import { useEffect, useState } from 'react'
import type { AppUpdateState } from '@shared/modules/updater'
import { APP_UPDATE_SOURCE, EV_APP_UPDATE_STATE } from '@shared/modules/updater'
import { fmtBytes } from '@shared/time'
import { appInfo, binsStatus, fetchBins, invoke, invokeSilent, on } from '../../api'
import { ProgressBar } from '../../components/ProgressBar'
import { TaskTable } from '../../components/TaskTable'
import { useT } from '../../i18n'
import { useTasks } from '../../store/tasks'
import { useUi } from '../../store/ui'

type BinsInfo = Awaited<ReturnType<typeof binsStatus>>

/** 'ffmpeg version 7.1-essentials_build ...' → '7.1-essentials_build' */
function shortVer(s: string | null | undefined): string {
  if (!s) return ''
  return s.match(/version\s+(\S+)/i)?.[1] ?? s
}

/**
 * Module Kiểm tra cập nhật (spec 4.11):
 * - tự kiểm tra/tải/cài bản app mới từ GitHub Releases cố định của ANS Video Tools
 * - trạng thái binaries (ffmpeg/ffprobe/yt-dlp) + Cập nhật yt-dlp + Tải FFmpeg + yt-dlp
 */
export default function Updater(): React.JSX.Element {
  const t = useT()
  const pushToast = useUi((s) => s.pushToast)

  const [version, setVersion] = useState('')
  const [update, setUpdate] = useState<AppUpdateState | null>(null)
  const [updateBusy, setUpdateBusy] = useState(false)
  const [bins, setBins] = useState<BinsInfo | null>(null)
  const [binsBusy, setBinsBusy] = useState(false)

  // đếm task fetch-bins / ytdlp-update đã kết thúc → tự làm mới trạng thái binaries
  const doneCount = useTasks((s) =>
    s.order.reduce((n, id) => {
      const task = s.byId[id]
      return task &&
        (task.type === 'fetch-bins' || task.type === 'ytdlp-update') &&
        (task.status === 'completed' || task.status === 'error' || task.status === 'killed')
        ? n + 1
        : n
    }, 0)
  )
  const activeTaskCount = useTasks((s) =>
    s.order.reduce((count, id) => {
      const task = s.byId[id]
      return task && (task.status === 'queued' || task.status === 'running') ? count + 1 : count
    }, 0)
  )

  useEffect(() => {
    void appInfo()
      .then((i) => setVersion(i.version))
      .catch(() => {})
    void invokeSilent<AppUpdateState>('mod:updater:state')
      .then(setUpdate)
      .catch(() => {})
    return on(EV_APP_UPDATE_STATE, (data) => setUpdate(data as AppUpdateState))
  }, [])

  useEffect(() => {
    // chạy lúc mount + mỗi khi có task cập nhật/tải binaries kết thúc
    void binsStatus()
      .then(setBins)
      .catch(() => {})
  }, [doneCount])

  const doCheck = async (): Promise<void> => {
    setUpdateBusy(true)
    try {
      const state = await invoke<AppUpdateState>('mod:updater:check')
      setUpdate(state)
      if (state.phase === 'up-to-date') {
        pushToast('success', t('Bạn đang dùng phiên bản mới nhất', 'You are on the latest version'))
      }
    } catch {
      /* invoke đã hiện toast lỗi */
    } finally {
      setUpdateBusy(false)
    }
  }

  const downloadUpdate = async (): Promise<void> => {
    setUpdateBusy(true)
    try {
      setUpdate(await invoke<AppUpdateState>('mod:updater:download'))
    } catch {
      /* invoke đã hiện toast lỗi */
    } finally {
      setUpdateBusy(false)
    }
  }

  const installUpdate = async (): Promise<void> => {
    if (
      activeTaskCount > 0 &&
      !window.confirm(
        t(
          `Đang có ${activeTaskCount} tác vụ chạy/chờ. Cài bản mới sẽ đóng ứng dụng và dừng các tác vụ này. Tiếp tục?`,
          `${activeTaskCount} task(s) are running/queued. Installing will close the app and stop them. Continue?`
        )
      )
    ) {
      return
    }
    setUpdateBusy(true)
    try {
      await invoke<boolean>('mod:updater:install')
    } finally {
      setUpdateBusy(false)
    }
  }

  const updateYtdlp = async (): Promise<void> => {
    setBinsBusy(true)
    try {
      await invoke<string>('mod:updater:ytdlp')
      pushToast('info', t('Đang cập nhật yt-dlp — theo dõi ở bảng tác vụ', 'Updating yt-dlp — see task table'))
    } catch {
      /* invoke đã hiện toast lỗi */
    } finally {
      setBinsBusy(false)
    }
  }

  const doFetchBins = async (): Promise<void> => {
    setBinsBusy(true)
    try {
      await fetchBins()
      pushToast('info', t('Đang tải FFmpeg + yt-dlp — theo dõi ở bảng tác vụ', 'Downloading FFmpeg + yt-dlp — see task table'))
    } catch {
      /* invoke đã hiện toast lỗi */
    } finally {
      setBinsBusy(false)
    }
  }

  const tools: { name: string; path: string | null; version: string }[] = [
    { name: 'FFmpeg', path: bins?.ffmpeg ?? null, version: shortVer(bins?.versions.ffmpeg) },
    { name: 'FFprobe', path: bins?.ffprobe ?? null, version: bins?.ffprobe ? shortVer(bins?.versions.ffmpeg) : '' },
    { name: 'yt-dlp', path: bins?.ytdlp ?? null, version: bins?.versions.ytdlp ?? '' }
  ]
  const missingBins = !!bins && (!bins.ffmpeg || !bins.ffprobe || !bins.ytdlp)
  const appVersion = update?.current || version
  const updateSource = update?.source || APP_UPDATE_SOURCE
  const updatePhase = update?.phase ?? 'disabled'
  const updateProgress = update?.progress

  return (
    <div>
      <div className="page-title">{t('Kiểm tra cập nhật', 'Check Updates')}</div>
      <div className="page-desc">
        {t(
          'Tự kiểm tra, tải và cài phiên bản ứng dụng mới; đồng thời cập nhật yt-dlp và quản lý binaries.',
          'Automatically check, download and install app updates; also update yt-dlp and manage binaries.'
        )}
      </div>

      <div className="card">
        <div className="card-title">
          {t('Phiên bản ứng dụng', 'App version')}
          {appVersion && <span className="badge">v{appVersion}</span>}
        </div>
        <div className="row wrap">
          <button
            className="btn btn-primary"
            disabled={
              updateBusy ||
              !update?.supported ||
              updatePhase === 'checking' ||
              updatePhase === 'downloading'
            }
            onClick={() => void doCheck()}
          >
            {updatePhase === 'checking' ? <span className="spin" /> : '🔄'}{' '}
            {t('Kiểm tra cập nhật', 'Check for updates')}
          </button>
          <span className="hint ellipsis" title={updateSource}>
            🔒 {t('Nguồn cố định', 'Locked source')}: {updateSource}
          </span>
        </div>

        {update && !update.supported && (
          <div className="hint mt">
            ℹ️{' '}
            {t(
              'Tự cập nhật chỉ hoạt động trong bản Windows đã đóng gói và cài đặt; chế độ development không tải installer.',
              'Auto-update works only in an installed packaged Windows build; development mode does not download installers.'
            )}
          </div>
        )}

        {updatePhase === 'checking' && (
          <div className="row mt text-dim">
            <span className="spin" /> {t('Đang kiểm tra máy chủ cập nhật...', 'Checking the update server...')}
          </div>
        )}

        {updatePhase === 'available' && (
          <div className="row mt wrap">
            <span className="text-success">
              🆕 {t('Có bản mới', 'New version available')}: <b>v{update?.latest}</b>
            </span>
            <span className="hint">{t('Đang chuẩn bị tải tự động...', 'Preparing automatic download...')}</span>
            <button className="btn btn-sm" disabled={updateBusy} onClick={() => void downloadUpdate()}>
              ⬇️ {t('Tải ngay', 'Download now')}
            </button>
          </div>
        )}

        {updatePhase === 'downloading' && (
          <div className="mt">
            <div className="row wrap mb">
              <span className="text-success">
                ⬇️ {t('Đang tải bản', 'Downloading version')} <b>v{update?.latest}</b>
              </span>
              {updateProgress && (
                <span className="hint mono">
                  {fmtBytes(updateProgress.transferred)} / {fmtBytes(updateProgress.total)} ·{' '}
                  {fmtBytes(updateProgress.bytesPerSecond)}/s
                </span>
              )}
            </div>
            <ProgressBar value={updateProgress?.percent ?? -1} />
          </div>
        )}

        {updatePhase === 'downloaded' && (
          <div className="row mt wrap">
            <span className="text-success">
              ✅ {t('Đã tải xong bản', 'Downloaded version')} <b>v{update?.latest}</b>
            </span>
            <button
              className="btn btn-success"
              disabled={updateBusy}
              onClick={() => void installUpdate()}
            >
              🔄 {t('Cài đặt & khởi động lại', 'Install & restart')}
            </button>
            <span className="hint">
              {t('Nếu đóng ứng dụng, bản mới cũng sẽ tự cài.', 'The update will also install automatically when the app exits.')}
            </span>
          </div>
        )}

        {updatePhase === 'up-to-date' && (
          <div className="text-success mt">
            ✅ {t('Bạn đang dùng phiên bản mới nhất', 'You are on the latest version')} (v{appVersion})
          </div>
        )}

        {updatePhase === 'error' && (
          <div className="mt">
            <span className="text-danger">❌ {update?.error}</span>
            {update?.latest && (
              <button
                className="btn btn-sm mt"
                disabled={updateBusy}
                onClick={() => void downloadUpdate()}
              >
                {t('Thử tải lại', 'Retry download')}
              </button>
            )}
          </div>
        )}

        {update?.changelog && updatePhase !== 'up-to-date' && (
          <div className="mt">
            <div className="text-dim" style={{ fontSize: 12, marginBottom: 4 }}>
              {t('Nhật ký thay đổi', 'Changelog')}:
            </div>
            <pre
              className="mono"
              style={{
                maxHeight: 240,
                overflow: 'auto',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
                margin: 0,
                padding: 10,
                fontSize: 12,
                background: 'var(--accent-soft)',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius-sm)'
              }}
            >
              {update.changelog}
            </pre>
          </div>
        )}
      </div>

      <div className="card">
        <div className="card-title">
          {t('Công cụ', 'Tools')}
          <span className="right">
            <button
              className="btn btn-sm btn-ghost"
              onClick={() => void binsStatus().then(setBins).catch(() => {})}
            >
              {t('Làm mới', 'Refresh')}
            </button>
          </span>
        </div>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>{t('Công cụ', 'Tool')}</th>
                <th>{t('Đường dẫn', 'Path')}</th>
                <th>{t('Phiên bản', 'Version')}</th>
                <th>{t('Trạng thái', 'Status')}</th>
              </tr>
            </thead>
            <tbody>
              {tools.map((tool) => (
                <tr key={tool.name}>
                  <td>{tool.name}</td>
                  <td className="mono ellipsis" style={{ maxWidth: 380, fontSize: 12 }} title={tool.path ?? ''}>
                    {tool.path ?? <span className="text-faint">{t('Không tìm thấy', 'Not found')}</span>}
                  </td>
                  <td className="mono" style={{ fontSize: 12 }}>
                    {tool.version || '—'}
                  </td>
                  <td>{bins ? (tool.path ? '✅' : '❌') : <span className="spin">⏳</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="row mt wrap">
          <button
            className="btn"
            disabled={binsBusy || !bins?.ytdlp}
            title={!bins?.ytdlp ? t('Chưa có yt-dlp — hãy tải trước', 'yt-dlp missing — download it first') : ''}
            onClick={() => void updateYtdlp()}
          >
            ⬆️ {t('Cập nhật yt-dlp', 'Update yt-dlp')}
          </button>
          {missingBins && (
            <button className="btn btn-primary" disabled={binsBusy} onClick={() => void doFetchBins()}>
              ⬇️ {t('Tải FFmpeg + yt-dlp', 'Download FFmpeg + yt-dlp')}
            </button>
          )}
          <span className="hint">
            {t(
              'Nên cập nhật yt-dlp thường xuyên vì các trang web đổi API liên tục.',
              'Update yt-dlp regularly — sites change their APIs frequently.'
            )}
          </span>
        </div>
      </div>

      <TaskTable types={['fetch-bins', 'ytdlp-update']} />
    </div>
  )
}
