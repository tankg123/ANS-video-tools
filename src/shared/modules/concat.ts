// Payload IPC cho module Ghép nối Video (spec 4.9)

/** Thông tin 1 file đã probe (phục vụ hiển thị + quyết định chế độ ghép) */
export interface ConcatFileInfo {
  path: string
  durationSec: number
  sizeBytes: number
  /** codec video (vd 'h264') */
  vcodec: string
  /** codec audio ('' nếu không có luồng audio) */
  acodec: string
  hasAudio: boolean
  width: number
  height: number
  fps: number
}

export interface ConcatAnalyzePayload {
  /** danh sách file theo đúng thứ tự ghép (>= 2 file) */
  inputs: string[]
}

export interface ConcatAnalyzeResult {
  /**
   * true = cùng video codec + audio codec + width/height + |fps chênh| < 0.5
   * → ghép bằng concat demuxer '-c copy' (tức thì).
   * false = phải chuẩn hoá (scale + fps + re-encode) — UI hiện dialog cảnh báo trước.
   */
  compatible: boolean
  infos: ConcatFileInfo[]
  /** độ phân giải chuẩn hoá (file có diện tích lớn nhất, làm tròn chẵn) */
  targetW: number
  targetH: number
  /** fps chuẩn hoá (fps cao nhất trong các file) */
  targetFps: number
  /** tổng thời lượng (giây) */
  totalDur: number
  /** lý do không tương thích (tiếng Việt, để UI hiển thị trong dialog cảnh báo) */
  reasons: string[]
}

export type ConcatMode = 'copy' | 're-encode'

export interface ConcatStartPayload {
  /** danh sách file theo đúng thứ tự ghép (>= 2 file) */
  inputs: string[]
  /** 'copy' chỉ hợp lệ khi analyze trả compatible=true (backend kiểm tra lại) */
  mode: ConcatMode
  /** thư mục xuất; rỗng = cạnh file đầu tiên */
  outputDir?: string
}

/** trả về taskId */
export type ConcatStartResult = string
