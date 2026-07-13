import type { AppUpdateState } from '@shared/modules/updater'
import { fmtBytes } from '@shared/time'
import logoUrl from '../assets/ans-logo.png'
import { useT } from '../i18n'
import { Icon } from './Icon'
import { ProgressBar } from './ProgressBar'

interface StartupUpdateScreenProps {
  state: AppUpdateState | null
  blocked: boolean
  onRetry(): void
}

export function StartupUpdateScreen({
  state,
  blocked,
  onRetry
}: StartupUpdateScreenProps): React.JSX.Element {
  const t = useT()
  const phase = state?.phase ?? 'checking'
  const isDownloading = phase === 'available' || phase === 'downloading'
  const isInstalling = phase === 'downloaded' || phase === 'installing'
  const hasError = phase === 'error'

  const title = hasError
    ? t('Chưa thể cập nhật ứng dụng', 'The app could not be updated')
    : isDownloading
      ? t('Đang tải phiên bản mới', 'Downloading the new version')
      : isInstalling
        ? t('Đang cài đặt phiên bản mới', 'Installing the new version')
        : t('Đang kiểm tra cập nhật', 'Checking for updates')

  const description = hasError
    ? blocked
      ? state?.updateAvailable
        ? t(
            'Đã tìm thấy phiên bản mới nhưng chưa thể hoàn tất tải hoặc cài đặt. Hãy thử lại trước khi đăng nhập.',
            'A new version is available, but its download or installation did not finish. Retry before signing in.'
          )
        : t(
            'Không thể xác minh an toàn thông tin phiên bản mới. Hãy thử lại trước khi đăng nhập.',
            'The new-version metadata could not be verified safely. Retry before signing in.'
          )
      : t(
          'Không thể kết nối máy chủ cập nhật. Ứng dụng sẽ tiếp tục tới bước đăng nhập.',
          'The update server could not be reached. The app will continue to sign-in.'
        )
    : isDownloading
      ? t(
          'ANS Video Tools sẽ cập nhật xong rồi tự khởi động lại trước khi đăng nhập.',
          'ANS Video Tools will finish updating and restart before sign-in.'
        )
      : isInstalling
        ? t(
            'Ứng dụng sắp khởi động lại. Vui lòng không tắt máy trong lúc cài đặt.',
            'The app is about to restart. Please keep your computer on during installation.'
          )
        : t(
            'Đang xác nhận bạn có phiên bản mới nhất trước khi bắt đầu đăng nhập.',
            'Making sure you have the latest version before sign-in begins.'
          )

  return (
    <main className="login-shell">
      <section className="startup-update-card" aria-live="polite" aria-busy={!hasError}>
        <div className="login-brand">
          <span className="login-logo"><img src={logoUrl} alt="ANS Studio" /></span>
          <span>
            <strong>ANS Video Tools</strong>
            <small>ANS STUDIO</small>
          </span>
        </div>

        <div className="startup-update-heading">
          <span className={`startup-update-icon${hasError ? ' is-error' : ''}`}>
            <Icon name={hasError ? 'alert' : 'refresh'} size={24} />
          </span>
          <div>
            <h1>{title}</h1>
            <p>{description}</p>
          </div>
        </div>

        {state?.updateAvailable && state.latest && (
          <div className="startup-update-version mono">
            <span>v{state.current}</span>
            <span aria-hidden="true">→</span>
            <strong>v{state.latest}</strong>
          </div>
        )}

        {isDownloading && (
          <div className="startup-update-progress">
            <ProgressBar value={state?.progress?.percent ?? -1} />
            {state?.progress && (
              <div className="startup-update-progress-copy mono">
                <span>
                  {fmtBytes(state.progress.transferred)} / {fmtBytes(state.progress.total)} ·{' '}
                  {fmtBytes(state.progress.bytesPerSecond)}/s
                </span>
              </div>
            )}
          </div>
        )}

        {!hasError && !isDownloading && (
          <div className="startup-update-wait">
            <span className="spin" />
            <span>{isInstalling
              ? t('Đang chuẩn bị khởi động lại...', 'Preparing to restart...')
              : t('Đang liên hệ máy chủ cập nhật...', 'Contacting the update server...')}
            </span>
          </div>
        )}

        {hasError && (
          <div className="startup-update-error" role="alert">
            <span>{state?.error || t('Lỗi cập nhật không xác định.', 'Unknown update error.')}</span>
            {blocked && (
              <button className="btn btn-primary" type="button" onClick={onRetry}>
                <Icon name="refresh" size={16} /> {t('Thử cập nhật lại', 'Retry update')}
              </button>
            )}
          </div>
        )}
      </section>
    </main>
  )
}
