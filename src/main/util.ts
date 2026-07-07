import fs from 'node:fs'
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
 * Sinh đường dẫn output: <dir>/<tên gốc><suffix>.<ext>, tự tránh ghi đè bằng " (n)".
 * dir rỗng → cùng thư mục file gốc (spec 5.5 — cùng ổ đĩa, tránh copy chéo ổ).
 */
export function deriveOutput(input: string, suffix: string, outDir?: string, ext?: string): string {
  const dir = outDir && outDir.trim() ? outDir : path.dirname(input)
  const base = path.basename(input, path.extname(input))
  const e = ext ?? path.extname(input) ?? '.mp4'
  let candidate = path.join(dir, `${base}${suffix}${e}`)
  let i = 1
  while (fs.existsSync(candidate)) {
    candidate = path.join(dir, `${base}${suffix} (${i})${e}`)
    i++
  }
  return candidate
}

/** Escape path cho file danh sách concat demuxer của ffmpeg (dòng: file 'path') */
export function concatEscape(p: string): string {
  return p.replace(/'/g, "'\\''")
}

/** Ghi file tạm (concat list...) vào thư mục đích — cùng ổ đĩa (spec 5.5). */
export function writeTempFile(nearFile: string, name: string, content: string): string {
  const dir = path.join(path.dirname(nearFile), '.vt-tmp')
  fs.mkdirSync(dir, { recursive: true })
  const p = path.join(dir, name)
  fs.writeFileSync(p, content, 'utf8')
  return p
}
