import { useEffect, useState } from 'react'
import type { UpdaterCheckResult } from '@shared/modules/updater'
import { appInfo, binsStatus, fetchBins, invoke, openExternal } from '../../api'
import { TaskTable } from '../../components/TaskTable'
import { useT } from '../../i18n'
import { useSettings } from '../../store/settings'
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
 * - kiểm tra phiên bản app qua settings.updateUrl (GitHub Releases API) → changelog + nút tải
 * - trạng thái binaries (ffmpeg/ffprobe/yt-dlp) + Cập nhật yt-dlp + Tải FFmpeg + yt-dlp
 */
export default function Updater(): React.JSX.Element {
  const t = useT()
  const pushToast = useUi((s) => s.pushToast)
  const updateUrl = useSettings((s) => s.settings?.updateUrl ?? '')

  const [version, setVersion] = useState('')
  const [check, setCheck] = useState<UpdaterCheckResult | null>(null)
  const [checking, setChecking] = useState(false)
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

  useEffect(() => {
    void appInfo()
      .then((i) => setVersion(i.version))
      .catch(() => {})
  }, [])

  useEffect(() => {
    // chạy lúc mount + mỗi khi có task cập nhật/tải binaries kết thúc
    void binsStatus()
      .then(setBins)
      .catch(() => {})
  }, [doneCount])

  const doCheck = async (): Promise<void> => {
    setChecking(true)
    try {
      const r = await invoke<UpdaterCheckResult>('mod:updater:check')
      setCheck(r)
      if (r.configured && !r.hasUpdate) {
        pushToast('success', t('Bạn đang dùng phiên bản mới nhất', 'You are on the latest version'))
      }
    } catch {
      /* invoke đã hiện toast lỗi */
    } finally {
      setChecking(false)
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

  return (
    <div>
      <div className="page-title">{t('Kiểm tra cập nhật', 'Check Updates')}</div>
      <div className="page-desc">
        {t(
          'Kiểm tra phiên bản ứng dụng mới, cập nhật yt-dlp và quản lý binaries FFmpeg / yt-dlp.',
          'Check for new app versions, update yt-dlp and manage FFmpeg / yt-dlp binaries.'
        )}
      </div>

      <div className="card">
        <div className="card-title">
          {t('Phiên bản ứng dụng', 'App version')}
          {version && <span className="badge">v{version}</span>}
        </div>
        <div className="row wrap">
          <button className="btn btn-primary" disabled={checking} onClick={() => void doCheck()}>
            {checking ? <span className="spin">⏳</span> : '🔄'} {t('Kiểm tra cập nhật', 'Check for updates')}
          </button>
          <span className="hint ellipsis" title={updateUrl}>
            {updateUrl
              ? `${t('Nguồn', 'Source')}: ${updateUrl}`
              : t('Chưa cấu hình URL cập nhật — vào Cài đặt để thêm', 'Update URL not configured — add it in Settings')}
          </span>
        </div>

        {check && !check.configured && (
          <div className="hint mt">
            ⚠️{' '}
            {t(
              'Chưa cấu hình URL cập nhật trong Cài đặt (định dạng GitHub Releases API, vd https://api.github.com/repos/<owner>/<repo>/releases/latest).',
              'Update URL is not configured in Settings (GitHub Releases API format, e.g. https://api.github.com/repos/<owner>/<repo>/releases/latest).'
            )}
          </div>
        )}

        {check?.configured &&
          (check.hasUpdate ? (
            <div className="mt">
              <div className="row wrap">
                <span className="text-success">
                  🆕 {t('Có bản mới', 'New version available')}: <b>v{check.latest}</b>
                </span>
                <span className="text-dim" style={{ fontSize: 12 }}>
                  ({t('hiện tại', 'current')}: v{check.current})
                </span>
                {check.url && (
                  <button className="btn btn-success btn-sm" onClick={() => void openExternal(check.url!)}>
                    ⬇️ {t('Tải bản mới', 'Download update')}
                  </button>
                )}
              </div>
              {check.changelog && (
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
                    {check.changelog}
                  </pre>
                </div>
              )}
            </div>
          ) : (
            <div className="text-success mt">
              ✅ {t('Bạn đang dùng phiên bản mới nhất', 'You are on the latest version')} (v{check.current})
            </div>
          ))}
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
