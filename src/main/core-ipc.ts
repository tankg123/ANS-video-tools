import { app, BrowserWindow, dialog, shell } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import type { AppInfo, AppSettings } from '@shared/types'
import { bundledBinDir, userDataDir } from './env'
import { binsStatus, binVersion, enqueueFetchBinaries } from './binaries'
import { killAllFfmpeg } from './ffmpeg'
import { detectHardware } from './hardware'
import { logger } from './logger'
import type { ModuleContext } from './module-context'
import { probeFile } from './probe'
import { settings } from './settings-store'
import { queue } from './task-queue'
import { isVideoFile, scanVideoDir } from './util'

const VIDEO_FILTERS = [
  { name: 'Video', extensions: ['mp4', 'mkv', 'mov', 'avi', 'flv', 'webm', 'ts', 'wmv', 'mpg', 'm4v', '3gp'] },
  { name: 'Tất cả file', extensions: ['*'] }
]

export function registerCoreIpc(ctx: ModuleContext, getWin: () => BrowserWindow | null): void {
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
  ctx.handle('core:settings:get', () => settings.all())
  ctx.handle('core:settings:set', (patch: Partial<AppSettings>) => {
    const s = settings.set(patch)
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

  // License cục bộ (stub — chưa có máy chủ): key chứa ngày YYYY-MM-DD → HSD ngày đó,
  // key khác/rỗng → Không giới hạn. Giữ chỗ cho tích hợp server + offline grace 3 ngày.
  ctx.handle('core:license:set', (p: { username: string; key: string }) => {
    const m = /(\d{4}-\d{2}-\d{2})/.exec(p.key ?? '')
    const expiry = m ? m[1] : null
    const s = settings.set({
      license: { username: p.username?.trim() || 'User', key: p.key ?? '', expiry, activatedAt: Date.now() }
    })
    return s.license
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
