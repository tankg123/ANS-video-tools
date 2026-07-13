import type {
  AppInfo,
  AppSettings,
  AuthStatus,
  BinsStatus,
  HwInfo,
  MediaInfo,
  TaskInfo
} from '@shared/types'
import { useUi } from './store/ui'

/** Bỏ prefix lỗi IPC của Electron cho dễ đọc. */
export function cleanError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e)
  return msg.replace(/^Error invoking remote method '[^']+':\s*(Error:\s*)?/, '')
}

/**
 * Gọi IPC; lỗi sẽ tự hiện toast đỏ rồi re-throw.
 * Dùng invokeSilent nếu muốn tự xử lý lỗi.
 */
export async function invoke<T = unknown>(channel: string, payload?: unknown): Promise<T> {
  try {
    return await window.vt.invoke<T>(channel, payload)
  } catch (e) {
    useUi.getState().pushToast('error', cleanError(e))
    throw e
  }
}

export async function invokeSilent<T = unknown>(channel: string, payload?: unknown): Promise<T> {
  return window.vt.invoke<T>(channel, payload)
}

export const on = (channel: string, cb: (data: unknown) => void): (() => void) =>
  window.vt.on(channel, cb)

export const pathForFile = (f: File): string => window.vt.pathForFile(f)

// ---- core wrappers ----
export const getAuthStatus = (): Promise<AuthStatus> =>
  invokeSilent('core:auth:status')

export const login = (username: string, password: string): Promise<AuthStatus> =>
  invokeSilent('core:auth:login', { username, password })

export const logout = (): Promise<AuthStatus> =>
  invokeSilent('core:auth:logout')

export const pickFiles = (opts?: {
  filters?: { name: string; extensions: string[] }[]
  multi?: boolean
}): Promise<string[]> => invoke('core:dialog:openFiles', opts)

export const pickFolder = (): Promise<string | null> => invoke('core:dialog:openFolder')

export const saveFile = (opts?: {
  defaultPath?: string
  filters?: { name: string; extensions: string[] }[]
}): Promise<string | null> => invoke('core:dialog:saveFile', opts)

export const probe = (path: string): Promise<MediaInfo> => invoke('core:probe', { path })

export const getSettings = (): Promise<AppSettings> => invoke('core:settings:get')
export const setSettings = (patch: Partial<AppSettings>): Promise<AppSettings> =>
  invoke('core:settings:set', patch)

export const listTasks = (): Promise<TaskInfo[]> => invoke('core:tasks:list')
export const cancelTask = (id: string): Promise<boolean> => invoke('core:tasks:cancel', { id })
export const clearFinishedTasks = (types?: string[]): Promise<string[]> =>
  invoke('core:tasks:clearFinished', { types })
export const killAllFfmpeg = (): Promise<{ cancelledTasks: number; killedProcesses: number }> =>
  invoke('core:killAllFfmpeg')

export const getHw = (force = false): Promise<HwInfo> => invoke('core:hw:get', { force })
export const binsStatus = (): Promise<BinsStatus & { versions: { ffmpeg: string | null; ytdlp: string | null } }> =>
  invoke('core:bins:status')
export const fetchBins = (): Promise<string> => invoke('core:bins:fetch')

export const readLog = (taskId: string, tail = 500): Promise<string[]> =>
  invoke('core:logs:read', { taskId, tail })

export const statPath = (
  path: string
): Promise<{ exists: boolean; isDirectory: boolean; isVideo: boolean; size: number }> =>
  invoke('core:statPath', { path })
export const scanDir = (path: string): Promise<string[]> => invoke('core:scanDir', { path })

export const openPath = (path: string): Promise<string> => invoke('core:openPath', { path })
export const showInFolder = (path: string): Promise<boolean> => invoke('core:showInFolder', { path })
export const openExternal = (url: string): Promise<boolean> => invoke('core:openExternal', { url })

export const appInfo = (): Promise<AppInfo> => invoke('core:appInfo')

export const kvGet = <T,>(ns: string, key: string, def: T): Promise<T> =>
  invoke('core:kv:get', { ns, key, def })
export const kvSet = (ns: string, key: string, value: unknown): Promise<boolean> =>
  invoke('core:kv:set', { ns, key, value })
