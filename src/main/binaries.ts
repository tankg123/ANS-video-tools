import { net } from 'electron'
import { execFile, execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { bundledBinDir, downloadedBinDir } from './env'
import type { BinsStatus } from '@shared/types'
import { queue } from './task-queue'

export type BinTool = 'ffmpeg' | 'ffprobe' | 'yt-dlp'

const cache = new Map<BinTool, string | null>()

function findInPath(name: string): string | null {
  try {
    const cmd = process.platform === 'win32' ? 'where' : 'which'
    const out = execFileSync(cmd, [name], { encoding: 'utf8', windowsHide: true })
    const first = out.split(/\r?\n/).map((s) => s.trim()).find(Boolean)
    return first ?? null
  } catch {
    return null
  }
}

/** Tìm binary: bin tải về (userData/bin) → bin đóng gói kèm app → PATH hệ thống. */
export function resolveBin(tool: BinTool): string | null {
  if (cache.has(tool)) return cache.get(tool)!
  const exe = process.platform === 'win32' ? `${tool}.exe` : tool
  for (const dir of [downloadedBinDir, bundledBinDir]) {
    const p = path.join(dir, exe)
    if (fs.existsSync(p)) {
      cache.set(tool, p)
      return p
    }
  }
  const found = findInPath(tool)
  cache.set(tool, found)
  return found
}

export function clearBinCache(): void {
  cache.clear()
}

export function binsStatus(): BinsStatus {
  return {
    ffmpeg: resolveBin('ffmpeg'),
    ffprobe: resolveBin('ffprobe'),
    ytdlp: resolveBin('yt-dlp')
  }
}

export function binVersion(tool: BinTool): Promise<string | null> {
  return new Promise((resolve) => {
    const bin = resolveBin(tool)
    if (!bin) return resolve(null)
    const args = tool === 'yt-dlp' ? ['--version'] : ['-version']
    execFile(bin, args, { windowsHide: true, timeout: 10000 }, (err, stdout) => {
      if (err) return resolve(null)
      resolve(stdout.split(/\r?\n/)[0]?.trim() ?? null)
    })
  })
}

async function downloadToFile(
  url: string,
  dest: string,
  onProgress: (pct: number, note: string) => void
): Promise<void> {
  const res = await net.fetch(url)
  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status} khi tải ${url}`)
  const total = Number(res.headers.get('content-length') ?? 0)
  fs.mkdirSync(path.dirname(dest), { recursive: true })
  const tmp = dest + '.part'
  const out = fs.createWriteStream(tmp)
  const reader = res.body.getReader()
  let received = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      received += value.byteLength
      if (!out.write(Buffer.from(value))) {
        await new Promise((r) => out.once('drain', r))
      }
      if (total > 0) {
        onProgress((received / total) * 100, `${Math.round(received / 1048576)} MB`)
      }
    }
  } finally {
    await new Promise((r) => out.end(r))
  }
  fs.renameSync(tmp, dest)
}

/**
 * Tải ffmpeg/ffprobe/yt-dlp về userData/bin (dùng khi máy user chưa có).
 * Trả về task id để UI theo dõi tiến trình.
 */
export function enqueueFetchBinaries(): string {
  return queue.add({
    type: 'fetch-bins',
    title: 'Tải FFmpeg + yt-dlp',
    pool: 'misc',
    run: async (api) => {
      fs.mkdirSync(downloadedBinDir, { recursive: true })

      if (!resolveBin('yt-dlp')) {
        api.update({ detail: 'yt-dlp.exe', progress: 0 })
        await downloadToFile(
          'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe',
          path.join(downloadedBinDir, 'yt-dlp.exe'),
          (pct, note) => api.update({ progress: pct * 0.2, detail: `yt-dlp.exe ${note}` })
        )
      }

      if (!resolveBin('ffmpeg') || !resolveBin('ffprobe')) {
        const zipPath = path.join(os.tmpdir(), 'vt-ffmpeg-essentials.zip')
        await downloadToFile(
          'https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip',
          zipPath,
          (pct, note) => api.update({ progress: 20 + pct * 0.7, detail: `ffmpeg.zip ${note}` })
        )
        api.update({ progress: 92, detail: 'Đang giải nén...' })
        const extractDir = path.join(os.tmpdir(), 'vt-ffmpeg-extract')
        await new Promise<void>((resolve, reject) => {
          execFile(
            'powershell',
            [
              '-NoProfile',
              '-Command',
              `Expand-Archive -LiteralPath '${zipPath}' -DestinationPath '${extractDir}' -Force`
            ],
            { windowsHide: true, timeout: 180000 },
            (err) => (err ? reject(err) : resolve())
          )
        })
        const stack = [extractDir]
        while (stack.length) {
          const dir = stack.pop()!
          for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const p = path.join(dir, entry.name)
            if (entry.isDirectory()) stack.push(p)
            else if (entry.name === 'ffmpeg.exe' || entry.name === 'ffprobe.exe') {
              fs.copyFileSync(p, path.join(downloadedBinDir, entry.name))
            }
          }
        }
        try {
          fs.rmSync(zipPath, { force: true })
          fs.rmSync(extractDir, { recursive: true, force: true })
        } catch {
          /* ignore */
        }
      }

      clearBinCache()
      const st = binsStatus()
      if (!st.ffmpeg || !st.ytdlp) throw new Error('Tải binaries chưa hoàn tất — kiểm tra mạng rồi thử lại')
      api.update({ progress: 100, detail: 'Hoàn tất' })
    }
  })
}
