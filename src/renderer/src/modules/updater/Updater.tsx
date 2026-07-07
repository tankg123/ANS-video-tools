import { useT } from '../../i18n'

// STUB — được thay thế bởi agent module 'updater' (spec 4.11)
export default function Updater(): React.JSX.Element {
  const t = useT()
  return (
    <div>
      <div className="page-title">{t('Kiểm tra cập nhật', 'Check Updates')}</div>
      <div className="empty-state">
        <div className="big">🚧</div>
        {t('Module đang được hoàn thiện...', 'Module under construction...')}
      </div>
    </div>
  )
}
