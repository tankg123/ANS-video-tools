import { useT } from '../../i18n'

// STUB — được thay thế bởi agent module 'super-live' (spec 4.1)
export default function SuperLive(): React.JSX.Element {
  const t = useT()
  return (
    <div>
      <div className="page-title">Super Live Stream</div>
      <div className="empty-state">
        <div className="big">🚧</div>
        {t('Module đang được hoàn thiện...', 'Module under construction...')}
      </div>
    </div>
  )
}
