// Payload IPC cho module Basic Live Stream (spec 4.2)

/**
 * 'copy'    = giữ nguyên codec nếu nguồn là H264+AAC (~0% CPU) — mặc định
 * 'auto-hw' = re-encode bằng encoder phần cứng tốt nhất đã dò (pickEncoder)
 * 'x264'    = re-encode bằng libx264 (CPU)
 */
export type BasicLiveEncoder = 'copy' | 'auto-hw' | 'x264'

export interface BasicLiveStartPayload {
  /** đường dẫn file video nguồn */
  input: string
  /** RTMP server URL, vd rtmp://a.rtmp.youtube.com/live2 */
  rtmpUrl: string
  /** stream key — được nối vào sau rtmpUrl: <rtmpUrl>/<streamKey> */
  streamKey: string
  /** phát lặp vô hạn (-stream_loop -1) */
  loop: boolean
  encoder: BasicLiveEncoder
  /** bitrate video khi re-encode, vd '4000k' */
  bitrate: string
}

/** trả về taskId */
export type BasicLiveStartResult = string
