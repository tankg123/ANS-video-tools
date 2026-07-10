import { BrowserWindow } from 'electron'
import os from 'node:os'
import type { SystemStats } from '@shared/types'
import { EV_STATS } from '@shared/types'
import { pm } from './process-manager'

function cpuTimes(): { idle: number; total: number } {
  let idle = 0
  let total = 0
  for (const cpu of os.cpus()) {
    idle += cpu.times.idle
    total += cpu.times.user + cpu.times.nice + cpu.times.sys + cpu.times.idle + cpu.times.irq
  }
  return { idle, total }
}

let timer: ReturnType<typeof setInterval> | null = null

/** Đồng hồ CPU/RAM ở status bar — poll 2s, chạy ở backend (spec 5.4). */
export function startSystemStats(): void {
  if (timer) return
  let prev = cpuTimes()
  timer = setInterval(() => {
    const cur = cpuTimes()
    const idleD = cur.idle - prev.idle
    const totalD = cur.total - prev.total
    prev = cur
    const cpu = totalD > 0 ? Math.round((1 - idleD / totalD) * 100) : 0
    const free = os.freemem()
    const total = os.totalmem()
    const stats: SystemStats = {
      cpu: Math.max(0, Math.min(100, cpu)),
      ramFreePct: Math.round((free / total) * 100),
      ramUsedMB: Math.round((total - free) / 1048576),
      ramTotalMB: Math.round(total / 1048576),
      processingProcesses: pm.trackedCount(new Set(['download']))
    }
    for (const w of BrowserWindow.getAllWindows()) {
      if (!w.isDestroyed()) w.webContents.send(EV_STATS, stats)
    }
  }, 2000)
}

export function stopSystemStats(): void {
  if (timer) {
    clearInterval(timer)
    timer = null
  }
}
