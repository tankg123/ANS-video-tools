import { app } from 'electron'
import { NsisUpdater, type ProgressInfo, type UpdateInfo } from 'electron-updater'
import { CancellationToken } from 'builder-util-runtime'
import type { ModuleContext } from '../module-context'
import type { AppUpdateState, StartupUpdateResult } from '@shared/modules/updater'
import {
  APP_UPDATE_OWNER,
  APP_UPDATE_REPO,
  APP_UPDATE_SOURCE,
  EV_APP_UPDATE_STATE
} from '@shared/modules/updater'

const AUTO_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000

export interface UpdaterController {
  /** Chạy đúng cổng startup: kiểm tra -> tải -> cài trước khi cho phép đăng nhập. */
  runStartup(): Promise<StartupUpdateResult>
}

function releaseNotes(info: UpdateInfo): string {
  if (typeof info.releaseNotes === 'string') return info.releaseNotes
  if (Array.isArray(info.releaseNotes)) {
    return info.releaseNotes
      .map((note) => [`v${note.version}`, note.note ?? ''].filter(Boolean).join('\n'))
      .join('\n\n')
  }
  return info.releaseName ?? ''
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Chỉ lỗi kết nối tạm thời mới được phép bỏ qua để tránh khóa app khi mất mạng. */
function isTransientCheckError(error: unknown): boolean {
  const details = typeof error === 'object' && error !== null
    ? error as { code?: unknown; statusCode?: unknown }
    : null
  const statusCode = details?.statusCode
  if (
    typeof statusCode === 'number' &&
    (statusCode === 408 || statusCode === 425 || statusCode === 429 || (statusCode >= 500 && statusCode <= 599))
  ) {
    return true
  }

  const code = typeof details?.code === 'string' ? details.code : ''
  if (
    /^(?:ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ECONNRESET|ECONNABORTED|ETIMEDOUT|ESOCKETTIMEDOUT|UND_ERR_CONNECT_TIMEOUT)$/i.test(code) ||
    /^HTTP_ERROR_(?:408|425|429|5\d\d)$/i.test(code)
  ) {
    return true
  }

  const message = messageOf(error)
  return (
    /\b(?:ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ECONNRESET|ECONNABORTED|ETIMEDOUT|ESOCKETTIMEDOUT|UND_ERR_CONNECT_TIMEOUT)\b/i.test(message) ||
    /net::ERR_(?:INTERNET_DISCONNECTED|NAME_NOT_RESOLVED|CONNECTION_(?:TIMED_OUT|RESET|REFUSED|CLOSED)|NETWORK_CHANGED)/i.test(message) ||
    /(?:fetch failed|socket hang up|network (?:error|request failed)|request (?:has been aborted by the server|timed? out)|rate limit|too many requests)/i.test(message) ||
    /\b(?:HTTP(?:\s*error)?[ /:]?|status(?: code)?[ :=]*)(?:408|425|429|5\d\d)\b/i.test(message)
  )
}

/**
 * App updater:
 * - Windows NSIS packaged build only.
 * - Update source is locked to the official public GitHub repository.
 * - Checks immediately at app startup, before authentication, then every six hours.
 * - A startup update is downloaded and installed before authentication can begin.
 */
export default function register(ctx: ModuleContext): UpdaterController {
  const current = app.getVersion()
  const isSupported = app.isPackaged && process.platform === 'win32'

  let state: AppUpdateState = {
    supported: isSupported,
    source: APP_UPDATE_SOURCE,
    phase: isSupported ? 'idle' : 'disabled',
    current,
    updateAvailable: false
  }
  let updater: NsisUpdater | null = null
  let activeDownload: { token: CancellationToken; promise: Promise<string[]> } | null = null
  let autoCheckInterval: ReturnType<typeof setInterval> | null = null
  let installTimer: ReturnType<typeof setTimeout> | null = null
  let activeStartup: Promise<StartupUpdateResult> | null = null
  let completedStartup: StartupUpdateResult | null = null
  let startupCheckMayFailOpen = false
  let startupBlockingFailureSeen = false

  const snapshot = (): AppUpdateState => ({
    ...state,
    supported: isSupported,
    source: APP_UPDATE_SOURCE,
    progress: state.progress ? { ...state.progress } : undefined
  })

  const patchState = (patch: Partial<AppUpdateState>): void => {
    state = { ...state, ...patch, supported: isSupported, source: APP_UPDATE_SOURCE }
    ctx.send(EV_APP_UPDATE_STATE, snapshot())
  }

  const wireUpdater = (instance: NsisUpdater): void => {
    // Download được quản lý bằng CancellationToken để app có thể dừng sạch khi thoát.
    instance.autoDownload = false
    instance.autoInstallOnAppQuit = true
    instance.autoRunAppAfterInstall = true
    instance.allowPrerelease = false
    instance.allowDowngrade = false
    instance.disableWebInstaller = true
    instance.logger = console

    instance.on('checking-for-update', () => {
      patchState({ phase: 'checking', error: undefined, progress: undefined })
    })
    instance.on('update-available', (info: UpdateInfo) => {
      patchState({
        phase: 'available',
        updateAvailable: true,
        latest: info.version,
        changelog: releaseNotes(info),
        checkedAt: Date.now(),
        error: undefined,
        progress: undefined
      })
    })
    instance.on('update-not-available', (info: UpdateInfo) => {
      patchState({
        phase: 'up-to-date',
        updateAvailable: false,
        latest: info.version,
        changelog: releaseNotes(info),
        checkedAt: Date.now(),
        error: undefined,
        progress: undefined
      })
    })
    instance.on('download-progress', (progress: ProgressInfo) => {
      patchState({
        phase: 'downloading',
        updateAvailable: true,
        progress: {
          percent: progress.percent,
          transferred: progress.transferred,
          total: progress.total,
          bytesPerSecond: progress.bytesPerSecond
        },
        error: undefined
      })
    })
    instance.on('update-downloaded', (info: UpdateInfo) => {
      patchState({
        phase: 'downloaded',
        updateAvailable: true,
        latest: info.version,
        changelog: releaseNotes(info),
        progress: state.progress ? { ...state.progress, percent: 100 } : undefined,
        error: undefined
      })
    })
    instance.on('update-cancelled', () => {
      patchState({ phase: 'error', error: 'Quá trình tải bản cập nhật đã bị hủy' })
    })
    instance.on('error', (error: Error) => {
      patchState({ phase: 'error', error: messageOf(error) })
    })
  }

  const getUpdater = (): NsisUpdater => {
    if (!isSupported) {
      throw new Error('Tự cập nhật chỉ hoạt động trong bản Windows đã được đóng gói và cài đặt')
    }
    if (updater) return updater

    const instance = new NsisUpdater({
      provider: 'github',
      owner: APP_UPDATE_OWNER,
      repo: APP_UPDATE_REPO
    })
    instance.fullChangelog = true
    wireUpdater(instance)
    updater = instance
    return instance
  }

  const startDownload = (instance: NsisUpdater): Promise<string[]> => {
    if (activeDownload) return activeDownload.promise
    if (!state.updateAvailable) return Promise.reject(new Error('Chưa phát hiện bản cập nhật mới để tải'))

    const token = new CancellationToken()
    patchState({ phase: 'downloading', updateAvailable: true, error: undefined, progress: undefined })
    const promise = instance.downloadUpdate(token)
    activeDownload = { token, promise }
    const clear = (): void => {
      if (activeDownload?.token === token) activeDownload = null
      token.dispose()
    }
    void promise.then(clear, clear)
    return promise
  }

  const checkForUpdates = async (
    background = false,
    autoDownload = true
  ): Promise<AppUpdateState> => {
    if (!isSupported) {
      patchState({ phase: 'disabled', error: undefined, progress: undefined })
      return snapshot()
    }

    try {
      if (!completedStartup) startupCheckMayFailOpen = false
      patchState({ phase: 'checking', error: undefined, progress: undefined })
      const instance = getUpdater()
      const result = await instance.checkForUpdates()
      if (!result) {
        if (!completedStartup) startupBlockingFailureSeen = true
        patchState({ phase: 'error', error: 'Bộ cập nhật không hoạt động trong bản cài đặt này' })
        return snapshot()
      }
      // electron-updater thường phát event trước khi resolve; nhánh này giữ state chắc chắn nếu event bị bỏ lỡ.
      if (state.phase === 'checking') {
        patchState(result.isUpdateAvailable
          ? {
              phase: 'available',
              updateAvailable: true,
              latest: result.updateInfo.version,
              changelog: releaseNotes(result.updateInfo),
              checkedAt: Date.now()
            }
          : {
              phase: 'up-to-date',
              updateAvailable: false,
              latest: result.updateInfo.version,
              changelog: releaseNotes(result.updateInfo),
              checkedAt: Date.now()
            })
      }
      if (!completedStartup) startupBlockingFailureSeen = state.phase === 'error'
      if (result.isUpdateAvailable && autoDownload) {
        void startDownload(instance).catch((error: unknown) => {
          patchState({ phase: 'error', error: messageOf(error) })
        })
      }
      return snapshot()
    } catch (error) {
      const message = messageOf(error)
      if (!completedStartup) {
        startupCheckMayFailOpen = isTransientCheckError(error)
        if (!startupCheckMayFailOpen) startupBlockingFailureSeen = true
      }
      patchState({ phase: 'error', error: message })
      if (!background) throw new Error(`Không thể kiểm tra cập nhật: ${message}`)
      return snapshot()
    }
  }

  const scheduleInstall = (silent = false): void => {
    if (state.phase === 'installing' || installTimer) return
    if (state.phase !== 'downloaded') throw new Error('Bản cập nhật chưa tải xong')

    const instance = getUpdater()
    patchState({ phase: 'installing', error: undefined })
    installTimer = setTimeout(() => {
      installTimer = null
      try {
        instance.quitAndInstall(silent, true)
      } catch (error) {
        patchState({ phase: 'error', error: `Không thể cài bản cập nhật: ${messageOf(error)}` })
      }
    }, 250)
  }

  const stopUpdaterActivity = (): void => {
    if (autoCheckInterval) {
      clearInterval(autoCheckInterval)
      autoCheckInterval = null
    }
    if (installTimer) {
      clearTimeout(installTimer)
      installTimer = null
    }
    activeDownload?.token.cancel()
  }

  const startAutomaticChecks = (): void => {
    if (!isSupported || autoCheckInterval) return
    autoCheckInterval = setInterval(() => void checkForUpdates(true), AUTO_CHECK_INTERVAL_MS)
  }

  const runStartup = (): Promise<StartupUpdateResult> => {
    if (completedStartup) return Promise.resolve(completedStartup)
    if (activeStartup) return activeStartup

    const run = (async (): Promise<StartupUpdateResult> => {
      if (!isSupported) {
        patchState({ phase: 'disabled', error: undefined, progress: undefined })
        return { state: snapshot(), readyForLogin: true }
      }

      if (state.phase === 'installing') {
        return { state: snapshot(), readyForLogin: false }
      }

      const checked = await checkForUpdates(true, false)
      if (checked.phase === 'available' || checked.phase === 'downloading') {
        try {
          await startDownload(getUpdater())
        } catch (error) {
          patchState({ phase: 'error', error: `Không thể tải bản cập nhật: ${messageOf(error)}` })
        }
      }

      if (state.phase === 'downloaded') scheduleInstall(true)

      const currentState = snapshot()
      const readyForLogin =
        currentState.phase === 'disabled' ||
        currentState.phase === 'up-to-date' ||
        (
          currentState.phase === 'error' &&
          !currentState.updateAvailable &&
          startupCheckMayFailOpen &&
          !startupBlockingFailureSeen
        )
      return { state: currentState, readyForLogin }
    })().catch((error: unknown) => {
      patchState({ phase: 'error', error: messageOf(error) })
      const currentState = snapshot()
      return {
        state: currentState,
        readyForLogin:
          !currentState.updateAvailable &&
          startupCheckMayFailOpen &&
          !startupBlockingFailureSeen
      }
    })

    activeStartup = run
    void run.then((result) => {
      if (result.readyForLogin) completedStartup = result
      startAutomaticChecks()
    }).finally(() => {
      if (activeStartup === run) activeStartup = null
    })
    return run
  }

  ctx.handle('mod:updater:startup', async () => runStartup(), { public: true })
  ctx.handle('mod:updater:state', async () => snapshot())
  ctx.handle('mod:updater:check', async () => checkForUpdates(false))
  ctx.handle('mod:updater:download', async () => {
    const instance = getUpdater()
    try {
      await startDownload(instance)
      return snapshot()
    } catch (error) {
      const message = messageOf(error)
      patchState({ phase: 'error', error: message })
      throw new Error(`Không thể tải bản cập nhật: ${message}`)
    }
  })
  ctx.handle('mod:updater:install', async () => {
    scheduleInstall()
    return true
  })

  // Cập nhật yt-dlp ('yt-dlp -U') — site đổi API liên tục.
  ctx.handle('mod:updater:ytdlp', async () => {
    const existing = ctx.queue
      .list()
      .find((task) => task.type === 'ytdlp-update' && (task.status === 'queued' || task.status === 'running'))
    if (existing) return existing.id
    const bin = ctx.resolveBin('yt-dlp')
    if (!bin) throw new Error('Không tìm thấy yt-dlp — hãy bấm "Tải FFmpeg + yt-dlp" trước')
    return ctx.queue.add({
      type: 'ytdlp-update',
      title: 'Cập nhật yt-dlp (yt-dlp -U)',
      pool: 'misc',
      run: (api) =>
        new Promise<void>((resolve, reject) => {
          api.update({ progress: -1, detail: 'Đang kiểm tra phiên bản yt-dlp...' })
          let lastLine = ''
          const { child } = ctx.pm.spawnManaged(bin, ['-U'], {
            onLine: (line) => {
              const text = line.trim()
              if (!text) return
              lastLine = text
              api.update({ detail: text.slice(0, 200) })
            }
          })
          api.update({ pid: child.pid })
          api.setCancelHook(() => ctx.pm.killTree(child.pid))
          child.on('error', (error) => reject(error))
          child.on('close', (code) => {
            if (api.isCancelled()) return resolve()
            if (code !== 0) return reject(new Error(`yt-dlp -U thoát mã ${code}: ${lastLine}`))
            api.update({ progress: 100, detail: lastLine || 'Hoàn tất' })
            resolve()
          })
        })
    })
  })

  if (isSupported) {
    app.once('before-quit', stopUpdaterActivity)
  }

  return { runStartup }
}
