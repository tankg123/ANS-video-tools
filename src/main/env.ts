import { app } from 'electron'
import path from 'node:path'
import fs from 'node:fs'

export const isDev = !app.isPackaged

export const userDataDir = app.getPath('userData')
export const logsDir = path.join(userDataDir, 'logs')
export const downloadedBinDir = path.join(userDataDir, 'bin')

/** bin/ đóng gói kèm app (dev: <project>/bin, prod: resources/bin) */
export const bundledBinDir = isDev
  ? path.join(app.getAppPath(), 'bin')
  : path.join(process.resourcesPath, 'bin')

export function ensureDirs(): void {
  for (const d of [logsDir, downloadedBinDir]) {
    try {
      fs.mkdirSync(d, { recursive: true })
    } catch {
      /* ignore */
    }
  }
}
