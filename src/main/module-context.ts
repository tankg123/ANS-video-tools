import { BrowserWindow, ipcMain } from 'electron'
import type { HwInfo, MediaInfo } from '@shared/types'
import { binsStatus, binVersion, resolveBin } from './binaries'
import type { BinTool } from './binaries'
import { enqueueFfmpeg, enqueueYtdlp, FfmpegTaskOptions, YtdlpTaskOptions } from './ffmpeg'
import { detectHardware, pickEncoder } from './hardware'
import { authSession } from './auth-session'
import { logger } from './logger'
import { pm, ProcessManager } from './process-manager'
import { probeFile } from './probe'
import { settings, SettingsStore } from './settings-store'
import { queue, TaskQueue } from './task-queue'
import { deriveOutput, isVideoFile, scanVideoDir, writeTempFile, concatEscape } from './util'

/**
 * Context cấp cho từng module backend (src/main/modules/*.ts).
 * Mỗi module export default function register(ctx: ModuleContext): void
 * và đăng ký các IPC channel dạng 'mod:<key>:<action>'.
 */
export interface ModuleContext {
  /** ipcMain.handle có guard trùng channel và yêu cầu phiên đăng nhập theo mặc định. */
  handle(
    channel: string,
    fn: (payload: never) => unknown,
    options?: { public?: boolean }
  ): void
  /** gửi event chủ động về renderer */
  send(channel: string, data: unknown): void

  queue: TaskQueue
  pm: ProcessManager
  settings: SettingsStore
  /** kho key-value bền vững theo namespace module (debounce ghi đĩa 1s) */
  kv(ns: string): { get<T>(key: string, def: T): T; set(key: string, value: unknown): void }

  resolveBin(tool: BinTool): string | null
  binsStatus: typeof binsStatus
  binVersion: typeof binVersion
  probe(path: string): Promise<MediaInfo>
  detectHardware(force?: boolean): Promise<HwInfo>
  pickEncoder(codec: 'h264' | 'hevc'): Promise<string>

  enqueueFfmpeg(opts: FfmpegTaskOptions): string
  enqueueYtdlp(opts: YtdlpTaskOptions): string
  readLog(taskId: string, tail?: number): string[]

  // helpers
  deriveOutput: typeof deriveOutput
  scanVideoDir: typeof scanVideoDir
  isVideoFile: typeof isVideoFile
  writeTempFile: typeof writeTempFile
  concatEscape: typeof concatEscape
}

const registered = new Set<string>()
const publicChannels = new Set<string>()

/** Chỉ dùng cho smoke test để phát hiện channel vô tình bị đánh dấu public. */
export function isProtectedIpcChannel(channel: string): boolean {
  return registered.has(channel) && !publicChannels.has(channel)
}

export function createModuleContext(): ModuleContext {
  return {
    handle: (channel, fn, options) => {
      if (registered.has(channel)) {
        console.warn(`IPC channel đăng ký trùng, bỏ qua: ${channel}`)
        return
      }
      registered.add(channel)
      if (options?.public) publicChannels.add(channel)
      ipcMain.handle(channel, async (_e, payload) => {
        if (!options?.public) authSession.assertAuthenticated()
        return fn(payload as never)
      })
    },
    send: (channel, data) => {
      for (const w of BrowserWindow.getAllWindows()) {
        if (w.isDestroyed()) continue
        try {
          w.webContents.send(channel, data)
        } catch {
          // Cửa sổ có thể bị đóng giữa lúc kiểm tra và gửi event.
        }
      }
    },
    queue,
    pm,
    settings,
    kv: (ns) => settings.ns(ns),
    resolveBin,
    binsStatus,
    binVersion,
    probe: probeFile,
    detectHardware,
    pickEncoder,
    enqueueFfmpeg,
    enqueueYtdlp,
    readLog: (taskId, tail) => logger.read(taskId, tail),
    deriveOutput,
    scanVideoDir,
    isVideoFile,
    writeTempFile,
    concatEscape
  }
}
