import { app } from 'electron'
import { NsisUpdater, type ProgressInfo, type UpdateInfo } from 'electron-updater'
import type { ModuleContext } from '../module-context'
import type { AppUpdateState } from '@shared/modules/updater'
import {
  APP_UPDATE_OWNER,
  APP_UPDATE_REPO,
  APP_UPDATE_SOURCE,
  EV_APP_UPDATE_STATE
} from '@shared/modules/updater'

const AUTO_CHECK_DELAY_MS = 10_000
const AUTO_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000

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

/**
 * App updater:
 * - Windows NSIS packaged build only.
 * - Update source is locked to the official public GitHub repository.
 * - Checks automatically after startup and every six hours.
 * - Downloads automatically; installs on normal app exit or via quitAndInstall.
 */
export default function register(ctx: ModuleContext): void {
  const current = app.getVersion()
  const isSupported = app.isPackaged && process.platform === 'win32'

  let state: AppUpdateState = {
    supported: isSupported,
    source: APP_UPDATE_SOURCE,
    phase: isSupported ? 'idle' : 'disabled',
    current
  }
  let updater: NsisUpdater | null = null

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
    instance.autoDownload = true
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

  const checkForUpdates = async (background = false): Promise<AppUpdateState> => {
    if (!isSupported) {
      patchState({ phase: 'disabled', error: undefined, progress: undefined })
      return snapshot()
    }

    try {
      patchState({ phase: 'checking', error: undefined, progress: undefined })
      await getUpdater().checkForUpdates()
      return snapshot()
    } catch (error) {
      const message = messageOf(error)
      patchState({ phase: 'error', error: message })
      if (!background) throw new Error(`Không thể kiểm tra cập nhật: ${message}`)
      return snapshot()
    }
  }

  ctx.handle('mod:updater:state', async () => snapshot())
  ctx.handle('mod:updater:check', async () => checkForUpdates(false))
  ctx.handle('mod:updater:download', async () => {
    const instance = getUpdater()
    patchState({ phase: 'downloading', error: undefined, progress: undefined })
    try {
      await instance.downloadUpdate()
      return snapshot()
    } catch (error) {
      const message = messageOf(error)
      patchState({ phase: 'error', error: message })
      throw new Error(`Không thể tải bản cập nhật: ${message}`)
    }
  })
  ctx.handle('mod:updater:install', async () => {
    if (state.phase !== 'downloaded') throw new Error('Bản cập nhật chưa tải xong')
    const instance = getUpdater()
    setTimeout(() => instance.quitAndInstall(false, true), 250)
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
    setTimeout(() => void checkForUpdates(true), AUTO_CHECK_DELAY_MS)
    setInterval(() => void checkForUpdates(true), AUTO_CHECK_INTERVAL_MS)
  }
}
