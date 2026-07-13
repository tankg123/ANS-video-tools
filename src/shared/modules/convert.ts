/** Định dạng đầu ra được hỗ trợ bởi bộ chuyển đổi video hàng loạt. */
export type ConvertOutputFormat = 'mp4' | 'flv'

export interface ConvertStartPayload {
  inputs: string[]
  format: ConvertOutputFormat
  /** Thư mục xuất; để trống sẽ lưu cạnh từng video nguồn. */
  outputDir?: string
}

export interface ConvertStartResult {
  /** Mỗi video hợp lệ tương ứng với một tác vụ FFmpeg độc lập. */
  taskIds: string[]
  /** File không tồn tại, không phải video hoặc không đọc được. */
  skipped: string[]
}
