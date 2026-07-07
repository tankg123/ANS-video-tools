// Parse tiến trình từ stderr FFmpeg và stdout yt-dlp (spec 5.3)

export interface FfmpegProgress {
  timeSec: number
  speed?: number
  fps?: string
  bitrate?: string
}

const FF_TIME = /time=\s*(\d+):(\d{2}):(\d{2}(?:\.\d+)?)/
const FF_SPEED = /speed=\s*([\d.]+)x/
const FF_FPS = /fps=\s*([\d.]+)/
const FF_BITRATE = /bitrate=\s*([\d.]+\s*\w?bits\/s)/

export function parseFfmpegLine(line: string): FfmpegProgress | null {
  const t = FF_TIME.exec(line)
  if (!t) return null
  const timeSec = parseInt(t[1], 10) * 3600 + parseInt(t[2], 10) * 60 + parseFloat(t[3])
  const sp = FF_SPEED.exec(line)
  const fps = FF_FPS.exec(line)
  const br = FF_BITRATE.exec(line)
  return {
    timeSec,
    speed: sp ? parseFloat(sp[1]) : undefined,
    fps: fps ? fps[1] : undefined,
    bitrate: br ? br[1] : undefined
  }
}

export interface YtdlpProgress {
  percent?: number
  totalSize?: string
  rate?: string
  eta?: string
  destination?: string
  merging?: string
  alreadyDone?: boolean
}

// "[download]  42.5% of ~ 120.5MiB at 2.5MiB/s ETA 00:35"
// Lưu ý: nhóm size phải greedy (\S+) — nếu lazy sẽ cắt size và làm speed/ETA không match
const DL_RE =
  /^\[download\]\s+([\d.]+)%(?:\s+of\s+~?\s*([\d.]+\s*\S+))?(?:\s+at\s+(\S+))?(?:\s+ETA\s+(\S+))?/
const DEST_RE = /^\[download\]\s+Destination:\s+(.+)$/
const MERGE_RE = /^\[Merger\]\s+Merging formats into\s+"(.+)"/
const ALREADY_RE = /has already been downloaded/

export function parseYtdlpLine(line: string): YtdlpProgress | null {
  const dest = DEST_RE.exec(line)
  if (dest) return { destination: dest[1].trim() }
  const merge = MERGE_RE.exec(line)
  if (merge) return { merging: merge[1].trim() }
  if (ALREADY_RE.test(line)) return { alreadyDone: true }
  const m = DL_RE.exec(line)
  if (!m) return null
  return {
    percent: parseFloat(m[1]),
    totalSize: m[2]?.trim(),
    rate: m[3] && m[3] !== 'Unknown' ? m[3] : undefined,
    eta: m[4] && m[4] !== 'Unknown' ? m[4] : undefined
  }
}

export function clampPct(n: number): number {
  if (!Number.isFinite(n)) return 0
  return Math.max(0, Math.min(100, n))
}

/** Tính ETA (giây) từ vị trí hiện tại + tốc độ ffmpeg */
export function ffmpegEta(durationSec: number, timeSec: number, speed?: number): string | undefined {
  if (!speed || speed <= 0 || !durationSec) return undefined
  const remain = Math.max(0, (durationSec - timeSec) / speed)
  const m = Math.floor(remain / 60)
  const s = Math.floor(remain % 60)
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}
