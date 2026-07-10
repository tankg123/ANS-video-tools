import { Icon } from './Icon'
import { MODULES, type ModuleGroup } from '../modules/registry'
import { useT } from '../i18n'
import { useUi } from '../store/ui'

const GROUPS: { key: ModuleGroup; vi: string; en: string }[] = [
  { key: 'processing', vi: 'Xử lý video', en: 'Video processing' },
  { key: 'editing', vi: 'Cắt & ghép', en: 'Edit & assemble' },
  { key: 'automation', vi: 'Tự động hóa', en: 'Automation' }
]

export function Sidebar(): React.JSX.Element {
  const t = useT()
  const active = useUi((s) => s.active)
  const setActive = useUi((s) => s.setActive)
  const updater = MODULES.find((m) => m.key === 'updater')!

  return (
    <aside className="sidebar">
      <div className="sidebar-scroll">
        <div className="sidebar-kicker">{t('Không gian làm việc', 'Workspace')}</div>
        {GROUPS.map((group) => (
          <section className="side-section" key={group.key}>
            <div className="side-section-title">{t(group.vi, group.en)}</div>
            {MODULES.filter((m) => m.group === group.key).map((m) => {
              const selected = active === m.key
              return (
                <button
                  key={m.key}
                  data-module-key={m.key}
                  className={`side-item${selected ? ' active' : ''}`}
                  onClick={() => setActive(m.key)}
                  aria-current={selected ? 'page' : undefined}
                  title={t(m.vi, m.en)}
                >
                  <span className="ico">
                    <Icon name={m.icon} size={18} />
                  </span>
                  <span className="side-item-label">{t(m.vi, m.en)}</span>
                  {selected && <Icon className="side-chevron" name="chevron-right" size={15} />}
                </button>
              )
            })}
          </section>
        ))}
      </div>

      <div className="side-system">
        <div className="side-section-title">{t('Hệ thống', 'System')}</div>
        <button
          data-module-key={updater.key}
          className={`side-item${active === updater.key ? ' active' : ''}`}
          onClick={() => setActive(updater.key)}
          aria-current={active === updater.key ? 'page' : undefined}
        >
          <span className="ico">
            <Icon name={updater.icon} size={18} />
          </span>
          <span className="side-item-label">{t(updater.vi, updater.en)}</span>
          <span className="side-live-dot" title={t('Nguồn cập nhật chính thức', 'Official update source')} />
        </button>
      </div>
    </aside>
  )
}
