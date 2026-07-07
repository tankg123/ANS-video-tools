import { useT } from '../../i18n'

// STUB — được thay thế bởi agent module 'render' (spec 4.3)
export default function Render(): React.JSX.Element {
  const t = useT()
  return (
    <div>
      <div className="page-title">Render H264/H265</div>
      <div className="empty-state">
        <div className="big">🚧</div>
        {t('Module đang được hoàn thiện...', 'Module under construction...')}
      </div>
    </div>
  )
}
