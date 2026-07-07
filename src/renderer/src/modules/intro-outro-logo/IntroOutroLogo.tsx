import { useT } from '../../i18n'

// STUB — được thay thế bởi agent module 'intro-outro-logo' (spec 4.4)
export default function IntroOutroLogo(): React.JSX.Element {
  const t = useT()
  return (
    <div>
      <div className="page-title">{t('Chèn Intro / Outro / Logo', 'Intro / Outro / Logo')}</div>
      <div className="empty-state">
        <div className="big">🚧</div>
        {t('Module đang được hoàn thiện...', 'Module under construction...')}
      </div>
    </div>
  )
}
