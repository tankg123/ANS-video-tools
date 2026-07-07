import { ReactNode, useEffect } from 'react'
import { useT } from '../i18n'

export function Modal({
  title,
  onClose,
  children,
  actions,
  wide
}: {
  title: ReactNode
  onClose: () => void
  children: ReactNode
  actions?: ReactNode
  wide?: boolean
}): React.JSX.Element {
  const t = useT()
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="modal-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal${wide ? ' wide' : ''}`}>
        <div className="modal-title">
          {title}
          <button className="x" onClick={onClose} title={t('Đóng', 'Close')}>
            ✕
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {actions && <div className="modal-actions">{actions}</div>}
      </div>
    </div>
  )
}
