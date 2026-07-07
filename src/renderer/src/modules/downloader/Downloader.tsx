import { useT } from '../../i18n'

// STUB — được thay thế bởi agent module 'downloader' (spec 4.10)
export default function Downloader(): React.JSX.Element {
  const t = useT()
  return (
    <div>
      <div className="page-title">{t('Tải Video', 'Download Video')}</div>
      <div className="empty-state">
        <div className="big">🚧</div>
        {t('Module đang được hoàn thiện...', 'Module under construction...')}
      </div>
    </div>
  )
}
