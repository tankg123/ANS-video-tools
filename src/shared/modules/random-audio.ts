// Payload IPC cho module Ghép Âm Thanh Ngẫu Nhiên (random audio merge).
// Song song với module `random` (ghép video ngẫu nhiên) nhưng dành cho file âm thanh:
// nạp một kho audio → giữ "N file đầu" đúng thứ tự (kéo-thả), phần còn lại được chọn
// NGẪU NHIÊN, KHÔNG trùng lặp. Randomization tính ở renderer (để xem trước đúng bản sẽ tạo);
// backend chỉ nhận danh sách đã chốt và enqueue mỗi bản 1 task concat.

export type RandomAudioMode = 'copy' | 're-encode'

/** Định dạng đầu ra; MP3 là mặc định, WAV dùng PCM không nén. */
export type RandomAudioFormat = 'mp3' | 'wav'

export interface RandomAudioStartPayload {
  /**
   * Mỗi phần tử là 1 "bản ghép": danh sách file âm thanh theo ĐÚNG thứ tự concat.
   * Mỗi bản >= 2 file và không trùng lặp trong cùng bản.
   */
  jobs: string[][]
  /** true = luôn chuẩn hoá + re-encode; false = tự động (copy nếu cùng chuẩn, khác chuẩn thì re-encode) */
  forceReencode: boolean
  /** định dạng đầu ra (mặc định 'mp3') */
  format: RandomAudioFormat
  /** thư mục xuất; rỗng = cạnh file đầu tiên của mỗi bản */
  outputDir?: string
  /** ID ổn định của draft khi chạy từng bản; backend dùng để chống enqueue trùng trong cùng phiên. */
  draftId?: string
}

/** Trả về danh sách taskId (mỗi bản ghép 1 task). */
export type RandomAudioStartResult = string[]

export interface RandomAudioWavePayload {
  path: string
}

/** data URI PNG (ảnh sóng âm), vd 'data:image/png;base64,...' */
export type RandomAudioWaveResult = string

export interface RandomAudioScanPayload {
  dir: string
}

/** Danh sách đường dẫn file âm thanh tìm thấy trong thư mục (đệ quy). */
export type RandomAudioScanResult = string[]
