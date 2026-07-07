import { useT } from '../../i18n'

// STUB — được thay thế bởi agent module 'loop' (spec 4.8)
export default function Loop(): React.JSX.Element {
  const t = useT()
  return (
    <div>
      <div className="page-title">{t('Lặp lại Video', 'Loop Video')}</div>
      <div className="empty-state">
        <div className="big">🚧</div>
        {t('Module đang được hoàn thiện...', 'Module under construction...')}
      </div>
    </div>
  )
}
