import { net } from 'electron'
import { execFile, execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { ReadableStream as WebReadableStream } from 'node:stream/web'
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
  onProgress: (pct: number, note: string) => void,
  signal?: AbortSignal
): Promise<void> {
  const res = await net.fetch(url, signal ? { signal } : undefined)
  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status} khi tải ${url}`)
  const total = Number(res.headers.get('content-length') ?? 0)
  fs.mkdirSync(path.dirname(dest), { recursive: true })
  const tmp = dest + '.part'
  const out = fs.createWriteStream(tmp)
  const body = Readable.fromWeb(res.body as unknown as WebReadableStream<Uint8Array>)
  let received = 0
  body.on('data', (chunk: Buffer) => {
    received += chunk.byteLength
    if (total > 0) {
      onProgress((received / total) * 100, `${Math.round(received / 1048576)} MB`)
    }
  })
  try {
    // pipeline xử lý backpressure + lỗi của cả 2 stream (ENOSPC/EPERM/abort không crash main)
    await pipeline(body, out)
  } catch (err) {
    try {
      fs.rmSync(tmp, { force: true }) // dọn file .part dở dang
    } catch {
      /* ignore */
    }
    throw err
  }
  fs.renameSync(tmp, dest)
}

// ---------------- Real-ESRGAN (engine AI upscale) ----------------

const REALESRGAN_ZIP_URL =
  'https://github.com/xinntao/Real-ESRGAN/releases/download/v0.2.5.0/realesrgan-ncnn-vulkan-20220424-windows.zip'

/** Tìm engine Real-ESRGAN: userData/bin/realesrgan → <bundled bin>/realesrgan. */
export function resolveRealesrgan(): { exe: string; modelsDir: string } | null {
  for (const dir of [path.join(downloadedBinDir, 'realesrgan'), path.join(bundledBinDir, 'realesrgan')]) {
    const exe = path.join(dir, 'realesrgan-ncnn-vulkan.exe')
    if (fs.existsSync(exe)) {
      const models = path.join(dir, 'models')
      return { exe, modelsDir: fs.existsSync(models) ? models : dir }
    }
  }
  return null
}

/**
 * Tải engine Real-ESRGAN (~140MB, kèm models) về userData/bin/realesrgan.
 * Chỉ chạy khi user chủ động bấm nút trong module Nâng cấp 4K. Trả về task id.
 * Nếu đã có task tải đang chờ/chạy thì trả về id của task đó (không enqueue trùng).
 */
export function enqueueFetchRealesrgan(): string {
  // Guard chống enqueue trùng: pool 'misc' cho phép 2 task song song — 2 lần bấm nút
  // sẽ tạo 2 download cùng ghi 1 file zip → hỏng archive / rename EPERM.
  const existing = queue
    .list()
    .find(
      (t) => t.type === 'fetch-upscale-engine' && (t.status === 'queued' || t.status === 'running')
    )
  if (existing) return existing.id
  return queue.add({
    type: 'fetch-upscale-engine',
    title: 'Tải engine AI Real-ESRGAN',
    pool: 'misc',
    run: async (api) => {
      const ac = new AbortController()
      api.setCancelHook(() => ac.abort())
      // Tên zip duy nhất theo task — kể cả khi 2 task cùng chạy (race hiếm) cũng không
      // bao giờ ghi đè .part của nhau
      const zipPath = path.join(os.tmpdir(), `vt-realesrgan-${api.id}.zip`)
      const destDir = path.join(downloadedBinDir, 'realesrgan')
      const cleanZip = (): void => {
        try {
          fs.rmSync(zipPath, { force: true })
        } catch {
          /* ignore */
        }
      }
      try {
        if (resolveRealesrgan()) {
          api.update({ progress: 100, detail: 'Engine đã có sẵn' })
          return
        }
        await downloadToFile(
          REALESRGAN_ZIP_URL,
          zipPath,
          (pct, note) => api.update({ progress: pct * 0.9, detail: `realesrgan.zip ${note}` }),
          ac.signal
        )
        if (api.isCancelled()) {
          cleanZip()
          return
        }
        api.update({ progress: 92, detail: 'Đang giải nén...' })
        fs.mkdirSync(destDir, { recursive: true })
        const psq = (p: string): string => p.replace(/'/g, "''")
        await new Promise<void>((resolve, reject) => {
          execFile(
            'powershell',
            [
              '-NoProfile',
              '-Command',
              `Expand-Archive -LiteralPath '${psq(zipPath)}' -DestinationPath '${psq(destDir)}' -Force`
            ],
            { windowsHide: true, timeout: 180000 },
            (err) => (err ? reject(err) : resolve())
          )
        })
        cleanZip()
        if (api.isCancelled()) {
          try {
            fs.rmSync(destDir, { recursive: true, force: true })
          } catch {
            /* ignore */
          }
          return
        }
        if (!resolveRealesrgan()) throw new Error('Giải nén xong nhưng không tìm thấy realesrgan-ncnn-vulkan.exe')
        api.update({ progress: 100, detail: 'Hoàn tất' })
      } catch (err) {
        cleanZip()
        if (api.isCancelled()) return
        throw err
      }
    }
  })
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
      const ac = new AbortController()
      // user bấm dừng → abort fetch đang chạy; các bước sau kiểm tra isCancelled để thoát sớm
      api.setCancelHook(() => ac.abort())
      const zipPath = path.join(os.tmpdir(), 'vt-ffmpeg-essentials.zip')
      const extractDir = path.join(os.tmpdir(), 'vt-ffmpeg-extract')
      const cleanTemp = (): void => {
        try {
          fs.rmSync(zipPath, { force: true })
          fs.rmSync(extractDir, { recursive: true, force: true })
        } catch {
          /* ignore */
        }
      }

      try {
        fs.mkdirSync(downloadedBinDir, { recursive: true })

        if (!resolveBin('yt-dlp')) {
          api.update({ detail: 'yt-dlp.exe', progress: 0 })
          await downloadToFile(
            'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe',
            path.join(downloadedBinDir, 'yt-dlp.exe'),
            (pct, note) => api.update({ progress: pct * 0.2, detail: `yt-dlp.exe ${note}` }),
            ac.signal
          )
        }
        if (api.isCancelled()) return // huỷ êm — queue tự đánh dấu killed

        if (!resolveBin('ffmpeg') || !resolveBin('ffprobe')) {
          await downloadToFile(
            'https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip',
            zipPath,
            (pct, note) => api.update({ progress: 20 + pct * 0.7, detail: `ffmpeg.zip ${note}` }),
            ac.signal
          )
          if (api.isCancelled()) {
            cleanTemp()
            return
          }
          api.update({ progress: 92, detail: 'Đang giải nén...' })
          // escape dấu nháy đơn cho chuỗi single-quote PowerShell (nhân đôi ')
          const psq = (p: string): string => p.replace(/'/g, "''")
          await new Promise<void>((resolve, reject) => {
            execFile(
              'powershell',
              [
                '-NoProfile',
                '-Command',
                `Expand-Archive -LiteralPath '${psq(zipPath)}' -DestinationPath '${psq(extractDir)}' -Force`
              ],
              { windowsHide: true, timeout: 180000 },
              (err) => (err ? reject(err) : resolve())
            )
          })
          if (api.isCancelled()) {
            cleanTemp()
            return
          }
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
          cleanTemp()
        }

        clearBinCache()
        const st = binsStatus()
        if (!st.ffmpeg || !st.ytdlp) throw new Error('Tải binaries chưa hoàn tất — kiểm tra mạng rồi thử lại')
        api.update({ progress: 100, detail: 'Hoàn tất' })
      } catch (err) {
        if (api.isCancelled()) {
          cleanTemp()
          return // bị huỷ giữa chừng (abort/…): thoát êm, không báo lỗi
        }
        throw err
      }
    }
  })
}
