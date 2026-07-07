import { useT } from '../../i18n'

// STUB — được thay thế bởi agent module 'green-screen' (spec 4.7)
export default function GreenScreen(): React.JSX.Element {
  const t = useT()
  return (
    <div>
      <div className="page-title">{t('Chèn Phông Xanh', 'Green Screen')}</div>
      <div className="empty-state">
        <div className="big">🚧</div>
        {t('Module đang được hoàn thiện...', 'Module under construction...')}
      </div>
    </div>
  )
}
