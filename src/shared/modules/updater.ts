// Kiểu payload/response IPC cho module Kiểm tra cập nhật (spec 4.11)
// KHÔNG import electron/node/react ở đây.

export type AppUpdatePhase =
  | 'disabled'
  | 'idle'
  | 'checking'
  | 'available'
  | 'downloading'
  | 'downloaded'
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
  latest?: string
  changelog?: string
  progress?: AppUpdateProgress
  error?: string
  checkedAt?: number
}

export const EV_APP_UPDATE_STATE = 'mod:updater:state'

/** 'mod:updater:ytdlp' trả về taskId (type 'ytdlp-update', pool 'misc') */
export type UpdaterYtdlpResult = string
