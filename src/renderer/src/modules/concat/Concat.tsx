import { useT } from '../../i18n'

// STUB — được thay thế bởi agent module 'concat' (spec 4.9)
export default function Concat(): React.JSX.Element {
  const t = useT()
  return (
    <div>
      <div className="page-title">{t('Ghép nối Video', 'Concat Videos')}</div>
      <div className="empty-state">
        <div className="big">🚧</div>
        {t('Module đang được hoàn thiện...', 'Module under construction...')}
      </div>
    </div>
  )
}
