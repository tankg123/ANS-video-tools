import { useEffect, useState } from 'react'
import { appInfo, openExternal } from '../api'
import { useT, useToggleLang } from '../i18n'
import { useLang } from '../store/settings'
import { useUi } from '../store/ui'
import { Icon } from './Icon'

export function StatusBar(): React.JSX.Element {
  const t = useT()
  const lang = useLang()
  const toggle = useToggleLang()
  const stats = useUi((s) => s.stats)
  const [version, setVersion] = useState('')

  useEffect(() => {
    let alive = true
    void appInfo()
      .then((info) => {
        if (alive) setVersion(info.version)
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [])

  const cpu = stats?.cpu ?? 0
  const ramUsedPct = stats ? Math.max(0, Math.min(100, 100 - stats.ramFreePct)) : 0

  return (
    <footer className="statusbar">
      <span className="status-product">
        <span className="status-online" />
        ANS Video Tools {version && `v${version}`}
      </span>
      <span className="status-divider" />
      <span className="status-local">
        <Icon name="shield" size={13} />
        {t('Xử lý cục bộ', 'Local processing')}
      </span>
      <button
        className="status-link"
        onClick={() => void openExternal('https://github.com/tankg123/ANS-video-tools')}
      >
        GitHub <Icon name="external" size={12} />
      </button>

      <div className="spacer" />

      <div className="resource-meter" title={t('Mức sử dụng CPU', 'CPU usage')}>
        <Icon name="cpu" size={14} />
        <span>CPU</span>
        <i><b style={{ width: `${cpu}%` }} /></i>
        <strong>{stats ? `${cpu}%` : '—'}</strong>
      </div>
      <div className="resource-meter" title={t('Mức sử dụng bộ nhớ', 'Memory usage')}>
        <Icon name="memory" size={14} />
        <span>RAM</span>
        <i><b style={{ width: `${ramUsedPct}%` }} /></i>
        <strong>{stats ? `${ramUsedPct}%` : '—'}</strong>
      </div>

      <div className="lang-toggle" aria-label={t('Ngôn ngữ', 'Language')}>
        <button className={lang === 'vi' ? 'on' : ''} onClick={() => lang !== 'vi' && toggle()}>
          VI
        </button>
        <button className={lang === 'en' ? 'on' : ''} onClick={() => lang !== 'en' && toggle()}>
          EN
        </button>
      </div>
    </footer>
  )
}
