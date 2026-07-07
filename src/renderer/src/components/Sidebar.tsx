import { useT } from '../i18n'
import { MODULES } from '../modules/registry'
import { useUi } from '../store/ui'

export function Sidebar(): React.JSX.Element {
  const t = useT()
  const active = useUi((s) => s.active)
  const setActive = useUi((s) => s.setActive)

  const main = MODULES.filter((m) => m.key !== 'updater')
  const updater = MODULES.find((m) => m.key === 'updater')!

  return (
    <nav className="sidebar">
      {main.map((m) => (
        <button
          key={m.key}
          className={`side-item${active === m.key ? ' active' : ''}`}
          onClick={() => setActive(m.key)}
        >
          <span className="ico">{m.icon}</span>
          {t(m.vi, m.en)}
        </button>
      ))}
      <div className="grow" />
      <div className="side-sep" />
      <button
        className={`side-item${active === updater.key ? ' active' : ''}`}
        onClick={() => setActive(updater.key)}
      >
        <span className="ico">{updater.icon}</span>
        {t(updater.vi, updater.en)}
      </button>
    </nav>
  )
}
