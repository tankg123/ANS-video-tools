// Payload IPC cho module Chèn Intro / Outro / Logo (spec 4.4)

/** Vị trí logo: 4 góc hoặc chính giữa */
export type LogoPosition = 'tl' | 'tr' | 'bl' | 'br' | 'center'

export interface LogoOptions {
  /** đường dẫn file PNG trong suốt */
  path: string
  position: LogoPosition
  /** kích thước % theo bề rộng video chính (1-100) */
  widthPct: number
  /** độ mờ 0-100 (100 = đậm hoàn toàn) */
  opacityPct: number
  /** true = hiển thị toàn bộ video; false = dùng startSec/endSec */
  fullDuration: boolean
  /** giây bắt đầu hiển thị (khi fullDuration = false) */
  startSec?: number
  /** giây kết thúc hiển thị (khi fullDuration = false) */
  endSec?: number
}

export interface IntroOutroLogoStartPayload {
  /** danh sách video chính (hàng loạt — mỗi video = 1 task) */
  inputs: string[]
  /** file intro (tuỳ chọn) */
  intro?: string
  /** file outro (tuỳ chọn) */
  outro?: string
  /** logo PNG (tuỳ chọn) */
  logo?: LogoOptions
  /** thư mục xuất; rỗng = cùng thư mục file gốc */
  outputDir?: string
}

/** trả về danh sách taskId (mỗi video chính = 1 task) */
export type IntroOutroLogoStartResult = string[]
