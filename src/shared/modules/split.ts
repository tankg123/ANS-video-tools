// Payload IPC cho module Cắt chia nhỏ Video (spec 4.5)

/** 'duration' = chia theo thời lượng mỗi phần, 'parts' = chia theo số phần */
export type SplitMode = 'duration' | 'parts'

export interface SplitStartPayload {
  /** danh sách file video cần chia */
  inputs: string[]
  mode: SplitMode
  /** phút mỗi phần (mode = 'duration'), cho phép số lẻ (0.5 = 30s) */
  minutesPerPart?: number
  /** số phần (mode = 'parts'), số nguyên >= 2 */
  parts?: number
  /** true = re-encode chính xác từng frame, false = -c copy -f segment (nhanh) */
  precise: boolean
  /** thư mục xuất; rỗng = cùng thư mục file gốc */
  outputDir?: string
}

export interface SplitStartResult {
  /** taskId của các file đã đưa vào hàng đợi (mỗi file 1 task) */
  taskIds: string[]
  /** lỗi theo từng file không xử lý được: '<tên file>: <lý do>' */
  errors: string[]
}
