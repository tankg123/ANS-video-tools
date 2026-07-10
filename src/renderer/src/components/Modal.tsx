import { ReactNode, useEffect, useId, useRef } from 'react'
import { useT } from '../i18n'
import { Icon } from './Icon'

export function Modal({
  title,
  onClose,
  children,
  actions,
  wide,
  closeDisabled = false
}: {
  title: ReactNode
  onClose: () => void
  children: ReactNode
  actions?: ReactNode
  wide?: boolean
  closeDisabled?: boolean
}): React.JSX.Element {
  const t = useT()
  const titleId = useId()
  const dialogRef = useRef<HTMLDivElement>(null)
  const closeRef = useRef(onClose)
  const closeDisabledRef = useRef(closeDisabled)
  closeRef.current = onClose
  closeDisabledRef.current = closeDisabled

  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const getFocusable = (): HTMLElement[] =>
      dialogRef.current
        ? Array.from(
            dialogRef.current.querySelectorAll<HTMLElement>(
              'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])'
            )
          )
        : []
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        if (!closeDisabledRef.current) closeRef.current()
        return
      }
      if (e.key !== 'Tab' || !dialogRef.current) return
      const focusable = getFocusable()
      if (!focusable.length) {
        e.preventDefault()
        dialogRef.current.focus()
        return
      }
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault()
        first.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    requestAnimationFrame(() => (getFocusable()[0] ?? dialogRef.current)?.focus())
    return () => {
      window.removeEventListener('keydown', onKey)
      previous?.focus()
    }
  }, [])

  return (
    <div
      className="modal-overlay"
      onMouseDown={(e) => e.target === e.currentTarget && !closeDisabled && onClose()}
    >
      <div
        ref={dialogRef}
        className={`modal${wide ? ' wide' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <div className="modal-title" id={titleId}>
          {title}
          <button
            className="x"
            disabled={closeDisabled}
            onClick={onClose}
            title={t('Đóng', 'Close')}
            aria-label={t('Đóng', 'Close')}
          >
            <Icon name="x" size={18} />
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {actions && <div className="modal-actions">{actions}</div>}
      </div>
    </div>
  )
}
