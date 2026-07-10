import { app } from 'electron'
import { NsisUpdater, type ProgressInfo, type UpdateInfo } from 'electron-updater'
import type { ModuleContext } from '../module-context'
import type { AppUpdateState } from '@shared/modules/updater'
import { EV_APP_UPDATE_STATE } from '@shared/modules/updater'

const AUTO_CHECK_DELAY_MS = 10_000
const AUTO_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000

interface GithubRepo {
  owner: string
  repo: string
}

function githubRepoFromUrl(raw: string): GithubRepo | null {
  try {
    const url = new URL(raw)
    const parts = url.pathname.split('/').filter(Boolean)
    if (url.hostname.toLowerCase() === 'api.github.com' && parts[0] === 'repos') {
      const owner = parts[1]
      const repo = parts[2]?.replace(/\.git$/i, '')
      return owner && repo ? { owner, repo } : null
    }
    if (url.hostname.toLowerCase() === 'github.com') {
      const owner = parts[0]
      const repo = parts[1]?.replace(/\.git$/i, '')
      return owner && repo ? { owner, repo } : null
    }
  } catch {
    return null
  }
  return null
}

function genericFeedUrl(raw: string): string {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new Error('URL cập nhật không hợp lệ')
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error('URL cập nhật phải bắt đầu bằng http:// hoặc https://')
  }
  url.search = ''
  url.hash = ''
  url.pathname = url.pathname.replace(/\/latest(?:-[^/]+)?\.ya?ml$/i, '/')
  return url.toString().replace(/\/$/, '')
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

/**
 * App updater:
 * - Windows NSIS packaged build only.
 * - Accepts a GitHub repository/releases URL or a generic feed containing latest.yml.
 * - Checks automatically after startup and every six hours.
 * - Downloads automatically; installs on normal app exit or via quitAndInstall.
 */
export default function register(ctx: ModuleContext): void {
  const current = app.getVersion()
  const isSupported = app.isPackaged && process.platform === 'win32'
  const configuredUrl = (): string => (ctx.settings.all().updateUrl ?? '').trim()

  let state: AppUpdateState = {
    configured: configuredUrl() !== '',
    supported: isSupported,
    phase: isSupported && configuredUrl() ? 'idle' : 'disabled',
    current
  }
  let updater: NsisUpdater | null = null
  let updaterUrl = ''

  const snapshot = (): AppUpdateState => ({
    ...state,
    configured: configuredUrl() !== '',
    supported: isSupported,
    progress: state.progress ? { ...state.progress } : undefined
  })

  const patchState = (patch: Partial<AppUpdateState>): void => {
    state = { ...state, ...patch, configured: configuredUrl() !== '', supported: isSupported }
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
    const raw = configuredUrl()
    if (!raw) throw new Error('Chưa cấu hình URL cập nhật trong Cài đặt')
    if (updater && updaterUrl === raw) return updater

    const github = githubRepoFromUrl(raw)
    const instance = github
      ? new NsisUpdater({ provider: 'github', owner: github.owner, repo: github.repo })
      : new NsisUpdater({ provider: 'generic', url: genericFeedUrl(raw) })
    instance.fullChangelog = !!github
    wireUpdater(instance)
    updater = instance
    updaterUrl = raw
    return instance
  }

  const checkForUpdates = async (background = false): Promise<AppUpdateState> => {
    if (!configuredUrl() || !isSupported) {
      patchState({ phase: 'disabled', error: undefined, progress: undefined })
      if (background) return snapshot()
      if (!configuredUrl()) throw new Error('Chưa cấu hình URL cập nhật trong Cài đặt')
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
