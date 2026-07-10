import { Suspense, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { AppSettings, SystemStats, TaskInfo, ToastMsg } from '@shared/types'
import { EV_SETTINGS, EV_STATS, EV_TASK_REMOVED, EV_TASK_UPDATE, EV_TOAST } from '@shared/types'
import { listTasks, on } from './api'
import { Header } from './components/Header'
import { Icon } from './components/Icon'
import { ModuleErrorBoundary } from './components/ModuleErrorBoundary'
import { SettingsModal } from './components/SettingsModal'
import { Sidebar } from './components/Sidebar'
import { StatusBar } from './components/StatusBar'
import { Toasts } from './components/Toasts'
import { MODULES } from './modules/registry'
import { useT } from './i18n'
import { useSettings } from './store/settings'
import { useTasks } from './store/tasks'
import { useUi } from './store/ui'
import { applyAccentColor } from './theme'

export default function App(): React.JSX.Element {
  const t = useT()
  const active = useUi((s) => s.active)
  const ready = useSettings((s) => s.settings !== null)
  const accentColor = useSettings((s) => s.settings?.accentColor)
  const [bootError, setBootError] = useState<string | null>(null)
  const [bootAttempt, setBootAttempt] = useState(0)
  const tRef = useRef(t)
  tRef.current = t

  useLayoutEffect(() => {
    applyAccentColor(accentColor)
  }, [accentColor])

  useEffect(() => {
    let alive = true
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

    setBootError(null)
    void useSettings.getState().init().catch((error: unknown) => {
      if (!alive) return
      setBootError(error instanceof Error ? error.message : String(error))
    })
    void listTasks()
      .then((tasks) => {
        if (!alive) return
        const current = useTasks.getState().byId
        useTasks.getState().upsert(tasks.filter((task) => !current[task.id]))
      })
      .catch((error: unknown) => {
        if (!alive) return
        const translate = tRef.current
        useUi.getState().pushToast(
          'error',
          translate(
            `Không tải được lịch sử tác vụ: ${error instanceof Error ? error.message : String(error)}`,
            `Could not load task history: ${error instanceof Error ? error.message : String(error)}`
          )
        )
      })

    return () => {
      alive = false
      subs.forEach((unsubscribe) => unsubscribe())
    }
  }, [bootAttempt])

  const mod = MODULES.find((m) => m.key === active) ?? MODULES[0]
  const Active = mod.Component

  return (
    <div className="app-shell" data-module={mod.key}>
      <Header />
      <div className="app-body">
        <Sidebar />
        <main className="app-main">
          {bootError ? (
            <div className="boot-error" role="alert">
              <span className="module-error-icon"><Icon name="alert" size={28} /></span>
              <div>
                <strong>{t('Không thể khởi tạo ứng dụng', 'Could not initialize the application')}</strong>
                <p>{t('Kết nối với tiến trình hệ thống bị gián đoạn. Hãy thử khởi động lại phần giao diện.', 'The system process did not respond. Try initializing the workspace again.')}</p>
                <pre>{bootError}</pre>
                <button className="btn btn-primary" onClick={() => setBootAttempt((value) => value + 1)}>
                  <Icon name="refresh" size={16} /> {t('Thử lại', 'Try again')}
                </button>
              </div>
            </div>
          ) : ready ? (
            <div className="app-main-inner">
              <ModuleErrorBoundary
                key={mod.key}
                title={t('Module gặp sự cố', 'This module encountered an error')}
                description={t('Dữ liệu tác vụ vẫn an toàn. Hãy khởi động lại phần giao diện để tiếp tục.', 'Your task data is safe. Restart the interface to continue.')}
                retryLabel={t('Khởi động lại giao diện', 'Restart interface')}
              >
                <Suspense fallback={<div className="loading-page"><span className="loader-mark"><Icon name={mod.icon} size={22} /></span><span>{t('Đang chuẩn bị không gian làm việc...', 'Preparing your workspace...')}</span></div>}>
                  <Active key={mod.key} />
                </Suspense>
              </ModuleErrorBoundary>
            </div>
          ) : (
            <div className="loading-page">
              <span className="loader-mark"><Icon name="sparkles" size={22} /></span>
              <span>{t('Đang khởi tạo ANS Video Tools...', 'Initializing ANS Video Tools...')}</span>
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
