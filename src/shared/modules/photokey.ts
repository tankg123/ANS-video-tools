/** Màu phông cần loại bỏ. */
export type PhotokeyColor = 'green' | 'blue'

/** Các tham số dùng chung cho một lượt xử lý Photokey. */
export interface PhotokeyOptions {
  color: PhotokeyColor
  /** Ngưỡng dominance bắt đầu làm pixel trong suốt (mặc định 0.04). */
  tolLow: number
  /** Ngưỡng dominance coi chắc chắn là nền (mặc định 0.16). */
  tolHigh: number
  /** Số lượt co biên alpha 3x3 (mặc định 1). */
  choke: number
  /** Số lượt làm mềm alpha 3x3 (mặc định 1). */
  feather: number
  /** Cường độ khử ám màu phông, 0..1 (mặc định 1). */
  despill: number
}

/** Alias ngắn cho code UI dùng chung. */
export type PhotokeyParams = PhotokeyOptions

export interface PhotokeyRemovePayload extends PhotokeyOptions {
  src: string
  /** Thư mục xuất; rỗng = cạnh ảnh nguồn. */
  outputDir?: string
}

export interface PhotokeyRemoveResult {
  taskId: string
  outPath: string
}

export interface PhotokeyRemoveFolderPayload extends PhotokeyOptions {
  dir: string
  /** Thư mục xuất; rỗng = thư mục ảnh nguồn. */
  outputDir?: string
}

export interface PhotokeyRemoveFolderResult {
  count: number
  taskIds: string[]
  outDir: string
}

export interface PhotokeyReadImagePayload {
  path: string
}

export interface PhotokeyReadImageResult {
  dataUrl: string
}
