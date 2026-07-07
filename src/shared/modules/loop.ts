// Payload IPC cho module Lặp lại Video (spec 4.8)

export type LoopMode = 'duration' | 'count'

export interface LoopStartPayload {
  input: string
  /** 'duration' = lặp đến tổng thời lượng mục tiêu, 'count' = lặp theo số lần */
  mode: LoopMode
  /** tổng thời lượng mục tiêu (giây) — bắt buộc khi mode='duration' */
  targetSec?: number
  /** số lần phát tổng cộng (>= 1) — bắt buộc khi mode='count' */
  count?: number
  /** thư mục xuất; rỗng = cùng thư mục file gốc */
  outputDir?: string
}

/** trả về taskId */
export type LoopStartResult = string
