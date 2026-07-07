// Kiểu payload IPC cho module Tải Video (spec 4.10)
// KHÔNG import electron/node/react ở đây.

/** Chất lượng tải: best | chiều cao tối đa | chỉ âm thanh */
export type DlQuality = 'best' | '2160' | '1440' | '1080' | '720' | '480' | 'mp3' | 'm4a'

export type DlItemStatus = 'idle' | 'queued' | 'downloading' | 'done' | 'error'

/** Cấu hình cookies cho video cần đăng nhập */
export interface CookieConfig {
  mode: 'none' | 'file' | 'browser'
  /** đường dẫn cookies.txt khi mode = 'file' */
  file?: string
  /** 'chrome' | 'edge' | 'firefox' khi mode = 'browser' */
  browser?: string
}

/** Một video trong danh sách tải (persist qua kv namespace 'downloader') */
export interface DlItem {
  /** site id (yt-dlp) hoặc uuid */
  id: string
  url: string
  title: string
  durationSec?: number
  thumbnail?: string
  uploader?: string
  filesizeApprox?: number
  quality: DlQuality
  status: DlItemStatus
  /** task đang/đã chạy gần nhất (không còn hợp lệ sau khi restart app) */
  taskId?: string
  outputPath?: string
  error?: string
}

// ---- mod:downloader:fetchInfo ----
export interface FetchInfoPayload {
  url: string
  cookies?: CookieConfig
}
/** items đã phân giải (playlist/kênh → từng video); renderer merge vào danh sách */
export interface FetchInfoResult {
  items: DlItem[]
}

// ---- mod:downloader:download ----
export interface DownloadPayload {
  items: Pick<DlItem, 'id' | 'url' | 'title' | 'quality'>[]
  downloadDir: string
  cookies?: CookieConfig
}
export type DownloadResult = { itemId: string; taskId: string }[]

// ---- mod:downloader:stopAll ----
/** trả về số task đã huỷ */
export type StopAllResult = number
