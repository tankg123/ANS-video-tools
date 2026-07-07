import { useT } from '../../i18n'

// STUB — được thay thế bởi agent module 'split' (spec 4.5)
export default function Split(): React.JSX.Element {
  const t = useT()
  return (
    <div>
      <div className="page-title">{t('Cắt chia nhỏ Video', 'Split Video')}</div>
      <div className="empty-state">
        <div className="big">🚧</div>
        {t('Module đang được hoàn thiện...', 'Module under construction...')}
      </div>
    </div>
  )
}
