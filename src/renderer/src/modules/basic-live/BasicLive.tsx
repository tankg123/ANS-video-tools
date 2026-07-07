import { useT } from '../../i18n'

// STUB — được thay thế bởi agent module 'basic-live' (spec 4.2)
export default function BasicLive(): React.JSX.Element {
  const t = useT()
  return (
    <div>
      <div className="page-title">Basic Live Stream</div>
      <div className="empty-state">
        <div className="big">🚧</div>
        {t('Module đang được hoàn thiện...', 'Module under construction...')}
      </div>
    </div>
  )
}
