import { useUi } from '../store/ui'
import { useT } from '../i18n'
import { Icon, type IconName } from './Icon'

export function Toasts(): React.JSX.Element {
  const t = useT()
  const toasts = useUi((s) => s.toasts)
  const dismiss = useUi((s) => s.dismissToast)
  return (
    <div className="toast-wrap" aria-live="polite" aria-atomic="false">
      {toasts.map((toast) => {
        const meta: Record<typeof toast.type, { icon: IconName; vi: string; en: string }> = {
          info: { icon: 'activity', vi: 'Thông báo', en: 'Notice' },
          success: { icon: 'check', vi: 'Hoàn tất', en: 'Completed' },
          error: { icon: 'alert', vi: 'Có lỗi xảy ra', en: 'Something went wrong' }
        }
        const item = meta[toast.type]
        return (
          <div key={toast.id} className={`toast ${toast.type}`} role={toast.type === 'error' ? 'alert' : 'status'}>
            <span className="toast-icon"><Icon name={item.icon} size={17} /></span>
            <span className="toast-content">
              <strong>{t(item.vi, item.en)}</strong>
              <span>{toast.message}</span>
            </span>
            <button className="toast-close" onClick={() => dismiss(toast.id)} aria-label={t('Đóng', 'Dismiss')}>
              <Icon name="x" size={15} />
            </button>
          </div>
        )
      })}
    </div>
  )
}
