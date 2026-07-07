// Payload IPC cho module Render H264/H265 (spec 4.3)
// KHÔNG import electron/node/react ở đây.

export type RenderCodec = 'h264' | 'hevc'

export type RenderQualityMode = 'crf' | 'bitrate'

/** 'keep' = giữ nguyên; số = chiều cao đích (px), width tự tính chẵn (-2) */
export type RenderResolution = 'keep' | 2160 | 1440 | 1080 | 720 | 480

/** 'keep' = giữ nguyên FPS gốc */
export type RenderFpsOpt = 'keep' | 24 | 30 | 60

/** copy = giữ audio gốc (tự fallback AAC nếu codec không hợp MP4); aac192 = AAC 192k */
export type RenderAudioOpt = 'copy' | 'aac192'

export interface RenderOptions {
  codec: RenderCodec
  qualityMode: RenderQualityMode
  /** 0-51, mặc định 23 (chỉ dùng khi qualityMode = 'crf') */
  crf: number
  /** Mbps (chỉ dùng khi qualityMode = 'bitrate') */
  bitrateMbps: number
  /** libx264/libx265: ultrafast..slow; nvenc: p1..p7 (mặc định p4); encoder khác: bỏ qua */
  preset: string
  resolution: RenderResolution
  fps: RenderFpsOpt
  audio: RenderAudioOpt
  /** thư mục xuất; rỗng = cùng thư mục file gốc */
  outputDir?: string
}

export interface RenderStartPayload {
  inputs: string[]
  options: RenderOptions
}

export interface RenderStartResult {
  /** id các task đã vào hàng đợi (mỗi file 1 task) */
  taskIds: string[]
  /** file bị bỏ qua vì không probe được */
  skipped: string[]
}

export interface RenderEncoderPayload {
  codec: RenderCodec
}

export interface RenderEncoderResult {
  /** encoder ffmpeg sẽ dùng, vd 'h264_nvenc' | 'libx264' */
  encoder: string
}
