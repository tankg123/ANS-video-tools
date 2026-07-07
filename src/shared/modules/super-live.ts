// Payload IPC cho module Super Live Stream (spec 4.1)
// KHÔNG import electron/node/react ở đây.

export type SuperLiveEncoder = 'copy' | 'x264' | 'hw'

/** Cấu hình 1 luồng live — persist qua kv('super-live').set('streams', [...]) */
export interface SuperLiveStream {
  id: string
  name: string
  /** đường dẫn file video hoặc THƯ MỤC chứa video */
  source: string
  /** true nếu source là thư mục (backend sẽ tự xác minh lại bằng fs.stat) */
  isFolder: boolean
  rtmpUrl: string
  streamKey: string
  /** lặp vô hạn (-stream_loop -1) */
  loop: boolean
  /** phát ngẫu nhiên — chỉ áp dụng khi source là thư mục */
  shuffle: boolean
  encoder: SuperLiveEncoder
  /** kbps — dùng khi re-encode (x264/hw) */
  bitrate: number
  /** '' = giữ nguyên; ngược lại là chiều cao đích: '1080' | '720' | '480' (scale=-2:H, buộc re-encode) */
  resolution: string
  /** ISO datetime — hẹn giờ bắt đầu (tuỳ chọn) */
  scheduleStart?: string
  /** ISO datetime — hẹn giờ kết thúc (tuỳ chọn) */
  scheduleEnd?: string
}

export interface SuperLiveStartPayload {
  id: string
}

export interface SuperLiveStopPayload {
  id: string
}

/** 'mod:super-live:start' trả về taskId */
export type SuperLiveStartResult = string

/** meta gắn vào TaskInfo của task 'super-live' — UI join qua meta.streamId */
export interface SuperLiveTaskMeta {
  streamId: string
  mode: 'copy' | 're-encode'
  /** true khi task đang chờ đến giờ hẹn (scheduleStart) */
  waiting?: boolean
}
