import { execFile } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { MediaInfo } from '@shared/types'
import { resolveBin } from './binaries'

const cache = new Map<string, MediaInfo>()
const inFlight = new Map<string, Promise<MediaInfo>>()
const MAX_PARALLEL_PROBES = Math.min(8, Math.max(2, Math.floor(os.cpus().length / 2)))
const probeWaiters: Array<() => void> = []
let activeProbes = 0

function parseFps(rate?: string): number {
  if (!rate) return 0
  const [a, b] = rate.split('/').map(Number)
  if (!a) return 0
  if (!b) return a
  return Math.round((a / b) * 100) / 100
}

function normalizedPath(filePath: string): string {
  const resolved = path.resolve(filePath)
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved
}

async function withProbeSlot<T>(run: () => Promise<T>): Promise<T> {
  if (activeProbes >= MAX_PARALLEL_PROBES) {
    await new Promise<void>((resolve) => probeWaiters.push(resolve))
  }
  activeProbes++
  try {
    return await run()
  } finally {
    activeProbes = Math.max(0, activeProbes - 1)
    probeWaiters.shift()?.()
  }
}

async function executeProbe(ffprobe: string, filePath: string): Promise<MediaInfo> {
  const json = await new Promise<string>((resolve, reject) => {
    execFile(
      ffprobe,
      ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', filePath],
      { windowsHide: true, maxBuffer: 32 * 1024 * 1024, timeout: 30_000 },
      (error, stdout) =>
        error ? reject(new Error(`ffprobe lỗi: ${error.message}`)) : resolve(stdout)
    )
  })

  let data: {
    format?: { duration?: string; size?: string; bit_rate?: string }
    streams?: Array<Record<string, unknown>>
  }
  try {
    data = JSON.parse(json) as typeof data
  } catch {
    throw new Error('ffprobe trả về dữ liệu không hợp lệ')
  }

  const video = (data.streams ?? []).find((stream) => stream.codec_type === 'video')
  const audio = (data.streams ?? []).find((stream) => stream.codec_type === 'audio')
  return {
    path: filePath,
    durationSec: parseFloat(data.format?.duration ?? '0') || 0,
    sizeBytes: parseInt(data.format?.size ?? '0', 10) || 0,
    bitrate: parseInt(data.format?.bit_rate ?? '0', 10) || undefined,
    video: video
      ? {
          codec: String(video.codec_name ?? ''),
          width: Number(video.width ?? 0),
          height: Number(video.height ?? 0),
          fps: parseFps(String(video.avg_frame_rate ?? '')) || parseFps(String(video.r_frame_rate ?? '')),
          pixFmt: video.pix_fmt ? String(video.pix_fmt) : undefined
        }
      : undefined,
    audio: audio
      ? {
          codec: String(audio.codec_name ?? ''),
          sampleRate: audio.sample_rate ? parseInt(String(audio.sample_rate), 10) : undefined,
          channels: audio.channels ? Number(audio.channels) : undefined
        }
      : undefined
  }
}

/**
 * Chạy ffprobe có cache theo path + mtime và gộp mọi request trùng đang chạy.
 * Semaphore toàn cục ngăn batch lớn sinh hàng trăm process trước khi TaskQueue kịp giới hạn.
 */
export async function probeFile(filePath: string): Promise<MediaInfo> {
  const ffprobe = resolveBin('ffprobe')
  if (!ffprobe) {
    throw new Error('Không tìm thấy ffprobe — hãy tải binaries trong mục "Kiểm tra cập nhật"')
  }

  const absolutePath = path.resolve(filePath)
  let stat: fs.Stats
  try {
    stat = await fs.promises.stat(absolutePath)
  } catch {
    throw new Error(`File không tồn tại: ${filePath}`)
  }
  if (!stat.isFile()) throw new Error(`Đường dẫn không phải file: ${filePath}`)

  const key = `${normalizedPath(absolutePath)}::${stat.mtimeMs}::${stat.size}`
  const cached = cache.get(key)
  if (cached) return cached

  const pending = inFlight.get(key)
  if (pending) return pending

  const request = withProbeSlot(() => executeProbe(ffprobe, absolutePath))
  inFlight.set(key, request)
  try {
    const info = await request
    cache.set(key, info)
    if (cache.size > 500) {
      const oldest = cache.keys().next().value
      if (oldest) cache.delete(oldest)
    }
    return info
  } finally {
    if (inFlight.get(key) === request) inFlight.delete(key)
  }
}
