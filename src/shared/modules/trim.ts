// Payload IPC cho module Cắt ngắn Video (spec 4.6)

export interface TrimStartPayload {
  input: string
  /** giây */
  start: number
  /** giây */
  end: number
  /** true = re-encode chính xác từng frame, false = -c copy (nhanh) */
  precise: boolean
  /** thư mục xuất; rỗng = cùng thư mục file gốc */
  outputDir?: string
}

/** trả về taskId */
export type TrimStartResult = string
