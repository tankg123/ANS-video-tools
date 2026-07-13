// Kiểu payload/response IPC cho module Kiểm tra cập nhật (spec 4.11)
// KHÔNG import electron/node/react ở đây.

export type AppUpdatePhase =
  | 'disabled'
  | 'idle'
  | 'checking'
  | 'available'
  | 'downloading'
  | 'downloaded'
  | 'installing'
  | 'up-to-date'
  | 'error'

export interface AppUpdateProgress {
  percent: number
  transferred: number
  total: number
  bytesPerSecond: number
}

export const APP_UPDATE_OWNER = 'tankg123'
export const APP_UPDATE_REPO = 'ANS-video-tools'
export const APP_UPDATE_SOURCE = `https://github.com/${APP_UPDATE_OWNER}/${APP_UPDATE_REPO}/releases`

/** Snapshot trạng thái auto-update, dùng cho IPC và event main → renderer. */
export interface AppUpdateState {
  /** Auto-update chỉ hoạt động trong bản Windows đã đóng gói/cài đặt. */
  supported: boolean
  /** Nguồn cố định trong mã, người dùng không thể thay đổi trong ứng dụng. */
  source: string
  phase: AppUpdatePhase
  current: string
  /** Có metadata xác nhận một phiên bản mới hơn; không suy luận từ `latest`. */
  updateAvailable: boolean
  latest?: string
  changelog?: string
  progress?: AppUpdateProgress
  error?: string
  checkedAt?: number
}

/** Kết quả cổng cập nhật lúc mở app, trước khi bất kỳ phiên đăng nhập nào được bắt đầu. */
export interface StartupUpdateResult {
  state: AppUpdateState
  /** Chỉ true khi app không cần cập nhật, updater không được hỗ trợ, hoặc lần kiểm tra chưa thể kết nối. */
  readyForLogin: boolean
}

export const EV_APP_UPDATE_STATE = 'mod:updater:state'

/** 'mod:updater:ytdlp' trả về taskId (type 'ytdlp-update', pool 'misc') */
export type UpdaterYtdlpResult = string
