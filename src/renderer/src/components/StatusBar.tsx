import { useEffect, useState } from 'react'
import { appInfo, openExternal } from '../api'
import { useT, useToggleLang } from '../i18n'
import { useLang } from '../store/settings'
import { useUi } from '../store/ui'

export function StatusBar(): React.JSX.Element {
  const t = useT()
  const lang = useLang()
  const toggle = useToggleLang()
  const stats = useUi((s) => s.stats)
  const [version, setVersion] = useState('1.0.0')

  useEffect(() => {
    appInfo()
      .then((i) => setVersion(i.version))
      .catch(() => {})
  }, [])

  return (
    <footer className="statusbar">
      <span>© 2026 ANS Studio · Video Toolkit AIO Pro v{version}</span>
      <a onClick={() => void openExternal('https://facebook.com')}>Facebook</a>
      <a onClick={() => void openExternal('https://youtube.com')}>YouTube</a>
      <span>☎ 0900 000 000</span>
      <div className="spacer" />
      <div className="lang-toggle">
        <button className={lang === 'vi' ? 'on' : ''} onClick={() => lang !== 'vi' && toggle()}>
          VI
        </button>
        <button className={lang === 'en' ? 'on' : ''} onClick={() => lang !== 'en' && toggle()}>
          EN
        </button>
      </div>
      <span className="meter" title={t('Cập nhật mỗi 2 giây', 'Updates every 2s')}>
        🖥 CPU {stats ? `${stats.cpu}%` : '—'}
      </span>
      <span className="meter">
        💾 RAM {t('trống', 'free')} {stats ? `${stats.ramFreePct}%` : '—'}
      </span>
    </footer>
  )
}
