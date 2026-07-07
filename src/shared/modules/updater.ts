// Kiểu payload/response IPC cho module Kiểm tra cập nhật (spec 4.11)
// KHÔNG import electron/node/react ở đây.

/** Kết quả 'mod:updater:check' */
export interface UpdaterCheckResult {
  /** false = settings.updateUrl chưa được cấu hình */
  configured: boolean
  /** phiên bản app hiện tại (app.getVersion()) */
  current: string
  /** phiên bản mới nhất trên server (tag_name, đã bỏ tiền tố 'v') */
  latest?: string
  /** changelog — body của GitHub release */
  changelog?: string
  /** link mở trình duyệt để tải bản mới (html_url hoặc asset đầu tiên) */
  url?: string
  /** latest > current theo semver */
  hasUpdate?: boolean
}

/** 'mod:updater:ytdlp' trả về taskId (type 'ytdlp-update', pool 'misc') */
export type UpdaterYtdlpResult = string
