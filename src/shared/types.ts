// ============================================================
// Shared types — dùng chung giữa main process và renderer.
// KHÔNG import gì từ electron/node ở đây.
// ============================================================

export type TaskPool = 'ffmpeg' | 'download' | 'misc'

export type TaskStatus = 'queued' | 'running' | 'completed' | 'error' | 'killed'

export interface TaskInfo {
  id: string
  /** loại tác vụ, thường trùng key module: 'render' | 'trim' | 'download' | ... */
  type: string
  title: string
  pool: TaskPool
  status: TaskStatus
  /** 0..100, hoặc -1 = indeterminate (không rõ tổng) */
  progress: number
  speed?: string
  eta?: string
  /** dòng mô tả phụ (fps, bitrate, file đang xử lý...) */
  detail?: string
  pid?: number
  logFile?: string
  outputPath?: string
  createdAt: number
  startedAt?: number
  finishedAt?: number
  error?: string
  /** dữ liệu tuỳ module (vd downloader: itemId) */
  meta?: Record<string, unknown>
}

export interface MediaInfo {
  path: string
  durationSec: number
  sizeBytes: number
  bitrate?: number
  video?: {
    codec: string
    width: number
    height: number
    fps: number
    pixFmt?: string
  }
  audio?: {
    codec: string
    sampleRate?: number
    channels?: number
  }
}

export interface HwInfo {
  gpus: string[]
  /** encoder tốt nhất đã kiểm chứng chạy được */
  best: { h264: string; hevc: string }
  /** toàn bộ encoder khả dụng đã test OK */
  available: string[]
  testedAt: number
}

export interface BinsStatus {
  ffmpeg: string | null
  ffprobe: string | null
  ytdlp: string | null
}

export interface SystemStats {
  cpu: number
  ramFreePct: number
  ramUsedMB: number
  ramTotalMB: number
  /** Tiến trình xử lý cục bộ đang chạy, không gồm tải video. */
  processingProcesses: number
}

export interface LicenseInfo {
  username: string
  key: string
  /** ISO date hết hạn, null = Không giới hạn */
  expiry: string | null
  activatedAt?: number
}

export interface AppSettings {
  language: 'vi' | 'en'
  /** Màu nhấn chính của toàn bộ giao diện, dạng #RRGGBB. */
  accentColor: string
  license: LicenseInfo
  /** thư mục xuất mặc định cho các module xử lý ('' = cùng thư mục file gốc) */
  outputDir: string
  downloadDir: string
  maxFfmpeg: number
  maxDownloads: number
  encoderPref: 'auto' | 'nvenc' | 'qsv' | 'amf' | 'x264'
  autoStart: boolean
  hw?: HwInfo
}

export interface AppInfo {
  version: string
  platform: string
  userDataDir: string
  binDir: string
}

// ---- IPC event channels (main -> renderer) ----
export const EV_TASK_UPDATE = 'task:update' // TaskInfo[] (snapshot các task thay đổi, throttle 250ms)
export const EV_TASK_REMOVED = 'task:removed' // string[] (ids)
export const EV_STATS = 'stats:update' // SystemStats mỗi 2s
export const EV_SETTINGS = 'settings:update' // AppSettings
export const EV_TOAST = 'toast' // { type: 'info'|'success'|'error', message: string }

export interface ToastMsg {
  type: 'info' | 'success' | 'error'
  message: string
}
