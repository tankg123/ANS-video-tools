import { Suspense, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { AppUpdateState, StartupUpdateResult } from '@shared/modules/updater'
import { EV_APP_UPDATE_STATE } from '@shared/modules/updater'
import type { AppSettings, AuthUpdate, SystemStats, TaskInfo, ToastMsg } from '@shared/types'
import { EV_AUTH, EV_SETTINGS, EV_STATS, EV_TASK_REMOVED, EV_TASK_UPDATE, EV_TOAST } from '@shared/types'
import { cleanError, invokeSilent, listTasks, on } from './api'
import { Header } from './components/Header'
import { Icon } from './components/Icon'
import { LoginScreen } from './components/LoginScreen'
import { ModuleErrorBoundary } from './components/ModuleErrorBoundary'
import { SettingsModal } from './components/SettingsModal'
import { Sidebar } from './components/Sidebar'
import { StatusBar } from './components/StatusBar'
import { StartupUpdateScreen } from './components/StartupUpdateScreen'
import { Toasts } from './components/Toasts'
import { MODULES } from './modules/registry'
import { useT } from './i18n'
import { useAuth } from './store/auth'
import { useSettings } from './store/settings'
import { useTasks } from './store/tasks'
import { useUi } from './store/ui'
import { applyAccentColor } from './theme'

export default function App(): React.JSX.Element {
  const t = useT()
  const active = useUi((s) => s.active)
  const ready = useSettings((s) => s.settings !== null)
  const accentColor = useSettings((s) => s.settings?.accentColor)
  const authStatus = useAuth((s) => s.status)
  const authChecking = useAuth((s) => s.checking)
  const authenticated = authStatus?.authenticated === true
  const [bootError, setBootError] = useState<string | null>(null)
  const [bootAttempt, setBootAttempt] = useState(0)
  const [startupReady, setStartupReady] = useState(false)
  const [startupBlocked, setStartupBlocked] = useState(false)
  const [startupUpdate, setStartupUpdate] = useState<AppUpdateState | null>(null)
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
      on(EV_AUTH, (d) => {
        const update = d as AuthUpdate
        useAuth.getState().apply(update.status, update.reason)
        if (!update.status.authenticated) useUi.getState().setSettingsOpen(false)
      }),
      on(EV_TOAST, (d) => {
        const m = d as ToastMsg
        useUi.getState().pushToast(m.type, m.message)
      }),
      on(EV_APP_UPDATE_STATE, (d) => setStartupUpdate(d as AppUpdateState))
    ]

    setBootError(null)
    setStartupReady(false)
    setStartupBlocked(false)
    setStartupUpdate(null)
    void useSettings.getState().init().catch((error: unknown) => {
      if (!alive) return
      setBootError(cleanError(error))
    })
    void invokeSilent<StartupUpdateResult>('mod:updater:startup')
      .then(async (result) => {
        if (!alive) return
        setStartupUpdate(result.state)
        setStartupBlocked(!result.readyForLogin)
        if (!result.readyForLogin) return

        if (result.state.phase === 'error' && result.state.error) {
          const translate = tRef.current
          useUi.getState().pushToast(
            'error',
            translate(
              `Không thể kiểm tra cập nhật lúc khởi động: ${result.state.error}`,
              `The startup update check could not be completed: ${result.state.error}`
            )
          )
        }

        setStartupReady(true)
        await useAuth.getState().init()
      })
      .catch((error: unknown) => {
        if (!alive) return
        setBootError(cleanError(error))
      })

    return () => {
      alive = false
      subs.forEach((unsubscribe) => unsubscribe())
    }
  }, [bootAttempt])

  useEffect(() => {
    if (!authenticated) return
    let alive = true
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
    }
  }, [authenticated])

  if (bootError) {
    return (
      <main className="login-shell">
        <div className="boot-error" role="alert">
          <span className="module-error-icon"><Icon name="alert" size={28} /></span>
          <div>
            <strong>{t('Không thể khởi tạo ứng dụng', 'Could not initialize the application')}</strong>
            <p>{t('Kết nối với tiến trình hệ thống bị gián đoạn. Hãy thử khởi tạo lại.', 'The system process did not respond. Try initializing again.')}</p>
            <pre>{bootError}</pre>
            <button className="btn btn-primary" onClick={() => setBootAttempt((value) => value + 1)}>
              <Icon name="refresh" size={16} /> {t('Thử lại', 'Try again')}
            </button>
          </div>
        </div>
        <Toasts />
      </main>
    )
  }

  if (!startupReady) {
    return (
      <>
        <StartupUpdateScreen
          state={startupUpdate}
          blocked={startupBlocked}
          onRetry={() => setBootAttempt((value) => value + 1)}
        />
        <Toasts />
      </>
    )
  }

  if (!ready || authChecking) {
    return (
      <main className="login-shell">
        <div className="loading-page">
          <span className="loader-mark"><Icon name="shield" size={22} /></span>
          <span>{t('Đang kiểm tra quyền sử dụng...', 'Checking your access...')}</span>
        </div>
      </main>
    )
  }

  if (!authenticated) {
    return (
      <>
        <LoginScreen />
        <Toasts />
      </>
    )
  }

  const mod = MODULES.find((m) => m.key === active) ?? MODULES[0]
  const Active = mod.Component

  return (
    <div className="app-shell" data-module={mod.key}>
      <Header />
      <div className="app-body">
        <Sidebar />
        <main className="app-main">
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
        </main>
      </div>
      <StatusBar />
      <Toasts />
      <SettingsModal />
    </div>
  )
}
