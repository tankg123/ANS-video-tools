// Payload IPC cho module Chèn Phông Xanh (spec 4.7)

/** Vị trí lớp phủ trên video nền (dùng main_w/overlay_w như logo) */
export type GsPosition =
  | 'center'
  | 'top-left'
  | 'top-right'
  | 'bottom-left'
  | 'bottom-right'
  | 'custom'

/** Tham số chung cho render + preview */
export interface GreenScreenParams {
  /** video nền */
  background: string
  /** video/ảnh có phông xanh */
  overlay: string
  /** màu key dạng '#RRGGBB' (mặc định '#00ff00') */
  keyColor: string
  /** 0.01 - 1 (mặc định 0.3) */
  similarity: number
  /** 0 - 1 (mặc định 0.1) */
  blend: number
  position: GsPosition
  /** kích thước lớp phủ, % theo chiều rộng video nền (mặc định 100) */
  sizePct: number
  /** toạ độ px, chỉ dùng khi position = 'custom' */
  customX?: number
  /** toạ độ px, chỉ dùng khi position = 'custom' */
  customY?: number
}

export interface GreenScreenStartPayload extends GreenScreenParams {
  /** thư mục xuất; rỗng = cùng thư mục video nền */
  outputDir?: string
}

/** trả về taskId */
export type GreenScreenStartResult = string

export interface GreenScreenPreviewPayload extends GreenScreenParams {
  /** thời điểm (giây) trên video nền để lấy 1 frame xem thử */
  atSec: number
}

/** trả về data URL 'data:image/png;base64,...' */
export type GreenScreenPreviewResult = string
