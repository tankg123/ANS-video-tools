import { execFile } from 'node:child_process'
import fs from 'node:fs'
import type { MediaInfo } from '@shared/types'
import { resolveBin } from './binaries'

const cache = new Map<string, MediaInfo>()

function parseFps(rate?: string): number {
  if (!rate) return 0
  const [a, b] = rate.split('/').map(Number)
  if (!a) return 0
  if (!b) return a
  return Math.round((a / b) * 100) / 100
}

/**
 * Chạy ffprobe lấy thông tin media (spec 5.2 — quyết định copy hay re-encode).
 * Cache theo path + mtime.
 */
export async function probeFile(filePath: string): Promise<MediaInfo> {
  const ffprobe = resolveBin('ffprobe')
  if (!ffprobe) throw new Error('Không tìm thấy ffprobe — hãy tải binaries trong mục "Kiểm tra cập nhật"')
  let mtime = 0
  try {
    mtime = fs.statSync(filePath).mtimeMs
  } catch {
    throw new Error(`File không tồn tại: ${filePath}`)
  }
  const key = `${filePath}::${mtime}`
  const hit = cache.get(key)
  if (hit) return hit

  const json = await new Promise<string>((resolve, reject) => {
    execFile(
      ffprobe,
      ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', filePath],
      { windowsHide: true, maxBuffer: 32 * 1024 * 1024, timeout: 30000 },
      (err, stdout) => (err ? reject(new Error(`ffprobe lỗi: ${err.message}`)) : resolve(stdout))
    )
  })
  const data = JSON.parse(json)
  const v = (data.streams ?? []).find((s: { codec_type: string }) => s.codec_type === 'video')
  const a = (data.streams ?? []).find((s: { codec_type: string }) => s.codec_type === 'audio')
  const info: MediaInfo = {
    path: filePath,
    durationSec: parseFloat(data.format?.duration ?? '0') || 0,
    sizeBytes: parseInt(data.format?.size ?? '0', 10) || 0,
    bitrate: parseInt(data.format?.bit_rate ?? '0', 10) || undefined,
    video: v
      ? {
          codec: v.codec_name ?? '',
          width: v.width ?? 0,
          height: v.height ?? 0,
          fps: parseFps(v.avg_frame_rate) || parseFps(v.r_frame_rate),
          pixFmt: v.pix_fmt
        }
      : undefined,
    audio: a
      ? {
          codec: a.codec_name ?? '',
          sampleRate: a.sample_rate ? parseInt(a.sample_rate, 10) : undefined,
          channels: a.channels
        }
      : undefined
  }
  cache.set(key, info)
  if (cache.size > 500) {
    const first = cache.keys().next().value
    if (first) cache.delete(first)
  }
  return info
}
