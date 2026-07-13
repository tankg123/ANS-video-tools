import { app, BrowserWindow, dialog, shell } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import type { AppInfo, AppSettings, AuthStatus } from '@shared/types'
import type { StartupUpdateResult } from '@shared/modules/updater'
import { EV_AUTH } from '@shared/types'
import { authSession } from './auth-session'
import { bundledBinDir, userDataDir } from './env'
import { binsStatus, binVersion, enqueueFetchBinaries } from './binaries'
import { killAllFfmpeg } from './ffmpeg'
import { detectHardware } from './hardware'
import { logger } from './logger'
import type { ModuleContext } from './module-context'
import { pm } from './process-manager'
import { probeFile } from './probe'
import { settings } from './settings-store'
import { queue } from './task-queue'
import { isVideoFile, scanVideoDir } from './util'

const VIDEO_FILTERS = [
  { name: 'Video', extensions: ['mp4', 'mkv', 'mov', 'avi', 'flv', 'webm', 'ts', 'wmv', 'mpg', 'm4v', '3gp'] },
  { name: 'Tất cả file', extensions: ['*'] }
]

export function registerCoreIpc(
  ctx: ModuleContext,
  getWin: () => BrowserWindow | null,
  runStartupUpdate: () => Promise<StartupUpdateResult>
): void {
  const unsubscribeAuth = authSession.subscribe((update) => {
    if (update.reason === 'logout' || update.reason === 'expired') {
      queue.cancelPools(['ffmpeg', 'download', 'misc'])
      pm.killAllTracked()
    }
    ctx.send(EV_AUTH, update)
  })
  app.once('before-quit', unsubscribeAuth)

  const waitUntilLoginIsAllowed = async (): Promise<void> => {
    const result = await runStartupUpdate()
    if (result.readyForLogin) return
    throw new Error(
      result.state.error ||
      'Ứng dụng cần hoàn tất cập nhật phiên bản mới trước khi đăng nhập.'
    )
  }

  // ---- authentication (public IPC; quyền sử dụng chỉ được giữ trong main process) ----
  ctx.handle('core:auth:status', async (): Promise<AuthStatus> => {
    await waitUntilLoginIsAllowed()
    return authSession.initialize()
  }, { public: true })
  ctx.handle(
    'core:auth:login',
    async (p: { username: string; password: string }) => {
      await waitUntilLoginIsAllowed()
      return authSession.login(p)
    },
    { public: true }
  )
  ctx.handle('core:auth:logout', (): AuthStatus => authSession.logout(), { public: true })

  // ---- dialogs ----
  ctx.handle('core:dialog:openFiles', async (p: { filters?: { name: string; extensions: string[] }[]; multi?: boolean } = {}) => {
    const win = getWin()
    if (!win) return []
    const r = await dialog.showOpenDialog(win, {
      properties: p.multi === false ? ['openFile'] : ['openFile', 'multiSelections'],
      filters: p.filters ?? VIDEO_FILTERS
    })
    return r.canceled ? [] : r.filePaths
  })

  ctx.handle('core:dialog:openFolder', async () => {
    const win = getWin()
    if (!win) return null
    const r = await dialog.showOpenDialog(win, { properties: ['openDirectory'] })
    return r.canceled ? null : (r.filePaths[0] ?? null)
  })

  ctx.handle('core:dialog:saveFile', async (p: { defaultPath?: string; filters?: { name: string; extensions: string[] }[] } = {}) => {
    const win = getWin()
    if (!win) return null
    const r = await dialog.showSaveDialog(win, { defaultPath: p.defaultPath, filters: p.filters ?? VIDEO_FILTERS })
    return r.canceled ? null : (r.filePath ?? null)
  })

  // ---- settings / license ----
  ctx.handle('core:settings:get', () => settings.all(), { public: true })
  ctx.handle('core:settings:set', (patch: Partial<AppSettings>) => {
    // Dữ liệu license cục bộ cũ không còn là nguồn cấp quyền và không được phép ghi qua IPC.
    const safePatch: Partial<AppSettings> & Record<string, unknown> = { ...patch }
    delete safePatch['license']
    const s = settings.set(safePatch)
    queue.applySettingsLimits(s.maxFfmpeg, s.maxDownloads)
    if (typeof patch.autoStart === 'boolean') {
      try {
        app.setLoginItemSettings({ openAtLogin: patch.autoStart })
      } catch {
        /* ignore */
      }
    }
    return s
  })

  // ---- kv (persist module) ----
  ctx.handle('core:kv:get', (p: { ns: string; key: string; def?: unknown }) =>
    settings.ns(p.ns).get(p.key, p.def ?? null)
  )
  ctx.handle('core:kv:set', (p: { ns: string; key: string; value: unknown }) => {
    settings.ns(p.ns).set(p.key, p.value)
    return true
  })

  // ---- tasks ----
  ctx.handle('core:tasks:list', () => queue.list())
  ctx.handle('core:tasks:cancel', (p: { id: string }) => {
    queue.cancel(p.id)
    return true
  })
  ctx.handle('core:tasks:clearFinished', (p: { types?: string[] } = {}) => queue.clearFinished(p.types))
  ctx.handle('core:killAllFfmpeg', () => killAllFfmpeg())

  // ---- media / hardware / binaries ----
  ctx.handle('core:probe', (p: { path: string }) => probeFile(p.path))
  ctx.handle('core:hw:get', (p: { force?: boolean } = {}) => detectHardware(!!p.force))
  ctx.handle('core:bins:status', async () => {
    const st = binsStatus()
    return {
      ...st,
      versions: {
        ffmpeg: await binVersion('ffmpeg'),
        ytdlp: await binVersion('yt-dlp')
      }
    }
  })
  ctx.handle('core:bins:fetch', () => enqueueFetchBinaries())

  // ---- fs helpers ----
  ctx.handle('core:statPath', (p: { path: string }) => {
    try {
      const st = fs.statSync(p.path)
      return { exists: true, isDirectory: st.isDirectory(), isVideo: !st.isDirectory() && isVideoFile(p.path), size: st.size }
    } catch {
      return { exists: false, isDirectory: false, isVideo: false, size: 0 }
    }
  })
  ctx.handle('core:scanDir', (p: { path: string }) => scanVideoDir(p.path))

  // ---- logs / shell ----
  ctx.handle('core:logs:read', (p: { taskId: string; tail?: number }) => logger.read(p.taskId, p.tail ?? 500))
  ctx.handle('core:openPath', (p: { path: string }) => shell.openPath(p.path))
  ctx.handle('core:showInFolder', (p: { path: string }) => {
    shell.showItemInFolder(p.path)
    return true
  })
  ctx.handle('core:openExternal', (p: { url: string }) => {
    if (/^https?:\/\//i.test(p.url)) shell.openExternal(p.url)
    return true
  })

  // ---- app info ----
  ctx.handle('core:appInfo', (): AppInfo => ({
    version: app.getVersion(),
    platform: process.platform,
    userDataDir,
    binDir: bundledBinDir
  }))

  // đường dẫn thư mục phổ biến
  ctx.handle('core:getPath', (p: { name: 'downloads' | 'videos' | 'desktop' | 'documents' }) => {
    try {
      return app.getPath(p.name)
    } catch {
      return null
    }
  })

  ctx.handle('core:joinPath', (p: { parts: string[] }) => path.join(...p.parts))
}
