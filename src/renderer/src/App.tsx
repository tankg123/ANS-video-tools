import { Suspense, useEffect } from 'react'
import type { AppSettings, SystemStats, TaskInfo, ToastMsg } from '@shared/types'
import { EV_SETTINGS, EV_STATS, EV_TASK_REMOVED, EV_TASK_UPDATE, EV_TOAST } from '@shared/types'
import { listTasks, on } from './api'
import { Header } from './components/Header'
import { SettingsModal } from './components/SettingsModal'
import { Sidebar } from './components/Sidebar'
import { StatusBar } from './components/StatusBar'
import { Toasts } from './components/Toasts'
import { MODULES } from './modules/registry'
import { useSettings } from './store/settings'
import { useTasks } from './store/tasks'
import { useUi } from './store/ui'

export default function App(): React.JSX.Element {
  const active = useUi((s) => s.active)
  const ready = useSettings((s) => s.settings !== null)

  useEffect(() => {
    void useSettings.getState().init()
    listTasks()
      .then((l) => useTasks.getState().hydrate(l))
      .catch(() => {})

    const subs = [
      on(EV_TASK_UPDATE, (d) => useTasks.getState().upsert(d as TaskInfo[])),
      on(EV_TASK_REMOVED, (d) => useTasks.getState().remove(d as string[])),
      on(EV_STATS, (d) => useUi.getState().setStats(d as SystemStats)),
      on(EV_SETTINGS, (d) => useSettings.getState().apply(d as AppSettings)),
      on(EV_TOAST, (d) => {
        const m = d as ToastMsg
        useUi.getState().pushToast(m.type, m.message)
      })
    ]
    return () => subs.forEach((un) => un())
  }, [])

  const mod = MODULES.find((m) => m.key === active) ?? MODULES[0]
  const Active = mod.Component

  return (
    <div className="app-shell">
      <Header />
      <div className="app-body">
        <Sidebar />
        <main className="app-main">
          {ready ? (
            <Suspense
              fallback={
                <div className="loading-page">
                  <span className="spin" />
                </div>
              }
            >
              <Active key={mod.key} />
            </Suspense>
          ) : (
            <div className="loading-page">
              <span className="spin" />
            </div>
          )}
        </main>
      </div>
      <StatusBar />
      <Toasts />
      <SettingsModal />
    </div>
  )
}
