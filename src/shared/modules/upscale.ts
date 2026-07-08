// Payload IPC cho module Nâng cấp 4K (Upscale)

export type UpscaleEngine = 'realesrgan' | 'fast'

/**
 * Model Real-ESRGAN:
 * - realesrgan-x4plus: ảnh/video quay thực (x4)
 * - realesrgan-x4plus-anime: anime/hoạt hình (x4)
 * - realesr-animevideov3: video anime, nhanh hơn nhiều (x2/x3/x4)
 */
export type UpscaleModel = 'realesrgan-x4plus' | 'realesrgan-x4plus-anime' | 'realesr-animevideov3'

export interface UpscaleStartPayload {
  inputs: string[]
  /** 'realesrgan' = AI từng khung hình (cực nét, chậm); 'fast' = FFmpeg Lanczos + CAS (nhanh) */
  engine: UpscaleEngine
  /** chỉ dùng khi engine='realesrgan' */
  model: UpscaleModel
  /** cạnh NGẮN đích: 2160 (4K) | 1440 (2K) */
  target: 2160 | 1440
  codec: 'h264' | 'hevc'
  /** thư mục xuất; rỗng = cùng thư mục file gốc */
  outputDir?: string
  /** khung hình trung gian (AI): 'jpg' nhanh + nhẹ đĩa ~6 lần (mặc định), 'png' lossless */
  frameFormat?: 'jpg' | 'png'
  /** tile size GPU (AI): 0 = tự động; 512 nhanh hơn nếu VRAM ≥ 8GB, 256 cho VRAM thấp */
  tileSize?: 0 | 256 | 512
  /** giới hạn FPS đầu ra: 0 = giữ nguyên; 30/24 giảm số khung phải xử lý (60→30 ≈ nhanh 2×) */
  fpsLimit?: 0 | 24 | 30
}

export interface UpscaleStartResult {
  taskIds: string[]
  errors: { input: string; error: string }[]
}

export interface UpscaleEngineStatus {
  installed: boolean
  exePath: string | null
  modelsDir: string | null
}
