import { spawn, execFile, ChildProcess } from 'node:child_process'
import readline from 'node:readline'
import os from 'node:os'
import fs from 'node:fs'
import path from 'node:path'
import { userDataDir } from './env'

const PID_FILE = path.join(userDataDir, 'pids.json')
const OUR_IMAGES = new Set(['ffmpeg.exe', 'ffprobe.exe', 'yt-dlp.exe', 'realesrgan-ncnn-vulkan.exe'])

export interface SpawnOptions {
  cwd?: string
  /** gọi cho từng dòng stdout/stderr */
  onLine?: (line: string, stream: 'out' | 'err') => void
  /** nhãn phân loại process (vd 'download') để KILL ALL có thể chừa ra; mặc định 'misc' */
  tag?: string
}

function execFileP(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolve) => {
    execFile(cmd, args, { windowsHide: true, maxBuffer: 8 * 1024 * 1024 }, (_err, stdout) => {
      resolve(stdout?.toString() ?? '')
    })
  })
}

/**
 * Quản lý toàn bộ process con (ffmpeg / yt-dlp):
 * - spawn với priority BelowNormal để UI luôn mượt (spec 5.3)
 * - track PID vào file để dọn "process mồ côi" nếu app crash
 * - kill cả process tree (taskkill /T /F)
 */
export class ProcessManager {
  /** pid → tag ('download', 'ffmpeg', 'misc'...) */
  private pids = new Map<number, string>()
  private persistTimer: ReturnType<typeof setTimeout> | null = null

  spawnManaged(bin: string, args: string[], opts: SpawnOptions = {}): { child: ChildProcess } {
    const child = spawn(bin, args, {
      cwd: opts.cwd,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    })
    if (child.pid) {
      try {
        os.setPriority(child.pid, os.constants.priority.PRIORITY_BELOW_NORMAL)
      } catch {
        /* process có thể đã thoát ngay */
      }
      this.pids.set(child.pid, opts.tag ?? 'misc')
      this.persistPids()
    }
    if (opts.onLine) {
      if (child.stdout) {
        readline
          .createInterface({ input: child.stdout })
          .on('line', (l) => opts.onLine!(l, 'out'))
      }
      if (child.stderr) {
        readline
          .createInterface({ input: child.stderr })
          .on('line', (l) => opts.onLine!(l, 'err'))
      }
    }
    child.on('close', () => {
      if (child.pid) {
        this.pids.delete(child.pid)
        this.persistPids()
      }
    })
    return { child }
  }

  /** Kill cả cây process (spec 5.3) — tránh ffmpeg mồ côi. */
  killTree(pid: number | undefined): void {
    if (!pid) return
    if (process.platform === 'win32') {
      execFile('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true }, () => {})
    } else {
      try {
        process.kill(-pid, 'SIGKILL')
      } catch {
        try {
          process.kill(pid, 'SIGKILL')
        } catch {
          /* ignore */
        }
      }
    }
  }

  /**
   * KILL ALL: diệt mọi PID đang track, trừ các tag trong excludeTags
   * (vd Set(['download']) — không đụng tác vụ tải video). Trả về số process đã kill.
   */
  killAllTracked(excludeTags?: Set<string>): number {
    let killed = 0
    for (const [pid, tag] of [...this.pids]) {
      if (excludeTags?.has(tag)) continue
      this.killTree(pid)
      killed++
    }
    return killed
  }

  trackedCount(excludeTags?: Set<string>): number {
    if (!excludeTags?.size) return this.pids.size
    let count = 0
    for (const tag of this.pids.values()) {
      if (!excludeTags.has(tag)) count++
    }
    return count
  }

  flushNow(): void {
    if (this.persistTimer) {
      clearTimeout(this.persistTimer)
      this.persistTimer = null
    }
    try {
      const tempFile = `${PID_FILE}.${process.pid}.tmp`
      fs.writeFileSync(tempFile, JSON.stringify([...this.pids.keys()]), 'utf8')
      fs.renameSync(tempFile, PID_FILE)
    } catch {
      /* ignore */
    }
  }

  /**
   * Dọn process mồ côi từ phiên trước (app crash khi ffmpeg còn chạy):
   * đọc pids.json, xác minh đúng tên ffmpeg/yt-dlp rồi mới kill.
   */
  async orphanCleanup(): Promise<number> {
    let stale: number[] = []
    try {
      if (fs.existsSync(PID_FILE)) stale = JSON.parse(fs.readFileSync(PID_FILE, 'utf8'))
    } catch {
      stale = []
    }
    let killed = 0
    for (const pid of stale) {
      if (this.pids.has(pid)) continue
      const out = await execFileP('tasklist', ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'])
      const m = out.match(/^"([^"]+)"/m)
      if (m && OUR_IMAGES.has(m[1].toLowerCase())) {
        this.killTree(pid)
        killed++
      }
    }
    this.persistPids()
    return killed
  }

  private persistPids(): void {
    if (this.persistTimer) clearTimeout(this.persistTimer)
    this.persistTimer = setTimeout(() => this.flushNow(), 150)
  }
}

export const pm = new ProcessManager()
