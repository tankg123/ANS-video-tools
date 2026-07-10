import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const VIDEO_EXTS = new Set([
  '.mp4', '.mkv', '.mov', '.avi', '.flv', '.webm', '.ts', '.m2ts', '.wmv', '.mpg', '.mpeg', '.3gp', '.m4v'
])

export function isVideoFile(p: string): boolean {
  return VIDEO_EXTS.has(path.extname(p).toLowerCase())
}

/** Quét đệ quy 1 thư mục lấy danh sách file video (sắp theo tên). */
export function scanVideoDir(dir: string, maxDepth = 3): string[] {
  const out: string[] = []
  const walk = (d: string, depth: number): void => {
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(d, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      const p = path.join(d, e.name)
      if (e.isDirectory()) {
        if (depth < maxDepth) walk(p, depth + 1)
      } else if (isVideoFile(p)) {
        out.push(p)
      }
    }
  }
  walk(dir, 0)
  return out.sort((a, b) => a.localeCompare(b))
}

/**
 * Args chất lượng theo họ encoder:
 * - libx264/libx265: -crf
 * - NVENC: cần '-rc vbr -cq N -b:v 0' (thiếu -b:v 0 sẽ bị kẹp bitrate mặc định ~2Mbps)
 * - QSV/AMF: không có -cq, dùng -q:v
 */
export function encoderQualityArgs(enc: string, q = 19): string[] {
  if (enc === 'libx264' || enc === 'libx265') return ['-preset', 'veryfast', '-crf', String(q)]
  if (enc.includes('nvenc')) return ['-rc', 'vbr', '-cq', String(q), '-b:v', '0']
  return ['-q:v', String(q)]
}

/** Codec audio copy được vào container .mp4 an toàn */
export const MP4_SAFE_AUDIO = new Set(['aac', 'mp3', 'ac3', 'eac3', 'alac', 'mp2'])

const reservedOutputs = new Set<string>()
const TEMP_LIST_DIR = path.join(os.tmpdir(), 'ans-video-tools', 'lists')

function outputKey(filePath: string): string {
  const resolved = path.resolve(filePath)
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved
}

export function ensureOutputDir(dir: string): void {
  try {
    if (!fs.statSync(dir).isDirectory()) throw new Error()
  } catch {
    throw new Error(`Thư mục xuất không tồn tại hoặc không truy cập được: ${dir}`)
  }
}

/** Giữ chỗ một output chưa tồn tại; false nếu file hoặc task khác đã dùng đường dẫn đó. */
export function reserveOutput(filePath: string): boolean {
  const key = outputKey(filePath)
  if (fs.existsSync(filePath) || reservedOutputs.has(key)) return false
  reservedOutputs.add(key)
  return true
}

/**
 * Sinh đường dẫn output: <dir>/<tên gốc><suffix>.<ext>, tự tránh ghi đè bằng " (n)".
 * dir rỗng → cùng thư mục file gốc (spec 5.5 — cùng ổ đĩa, tránh copy chéo ổ).
 */
export function deriveOutput(input: string, suffix: string, outDir?: string, ext?: string): string {
  const dir = outDir && outDir.trim() ? outDir : path.dirname(input)
  ensureOutputDir(dir)
  const base = path.basename(input, path.extname(input))
  const e = ext ?? (path.extname(input) || '.mp4')
  let candidate = path.join(dir, `${base}${suffix}${e}`)
  let i = 1
  while (!reserveOutput(candidate)) {
    candidate = path.join(dir, `${base}${suffix} (${i})${e}`)
    i++
  }
  return candidate
}

/** Nhả đường dẫn đã giữ sau khi task kết thúc. File đã tạo vẫn được existsSync bảo vệ. */
export function releaseOutput(filePath?: string): void {
  if (filePath) reservedOutputs.delete(outputKey(filePath))
}

/** Escape path cho file danh sách concat demuxer của ffmpeg (dòng: file 'path') */
export function concatEscape(p: string): string {
  return p.replace(/'/g, "'\\''")
}

/** Ghi concat list vào TEMP để nguồn read-only hoặc network share vẫn xử lý được. */
export function writeTempFile(_nearFile: string, name: string, content: string): string {
  fs.mkdirSync(TEMP_LIST_DIR, { recursive: true })
  const p = path.join(TEMP_LIST_DIR, `${randomUUID()}-${path.basename(name)}`)
  try {
    fs.writeFileSync(p, content, 'utf8')
    return p
  } catch (error) {
    try { fs.rmSync(p, { force: true }) } catch { /* ignore partial temp cleanup */ }
    throw error
  }
}

/** Xóa concat-list còn sót từ phiên trước; lúc startup chưa có task hợp lệ nào dùng chúng. */
export function sweepStaleTempFiles(): void {
  try {
    fs.rmSync(TEMP_LIST_DIR, { recursive: true, force: true, maxRetries: 2, retryDelay: 100 })
  } catch {
    /* file có thể đang bị antivirus giữ tạm; task mới vẫn dùng UUID nên không xung đột */
  }
}
