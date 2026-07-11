// Payload IPC cho module Ghép Video Ngẫu Nhiên (random merge).
// Ý tưởng: nạp một kho video → chọn "N video đầu" giữ đúng thứ tự (kéo-thả),
// phần còn lại trong bản ghép được chọn NGẪU NHIÊN, KHÔNG trùng lặp.
// Randomization được tính ở renderer (để xem trước đúng cái sẽ tạo);
// backend chỉ nhận danh sách đã chốt và enqueue mỗi bản 1 task concat.

export type RandomMode = 'copy' | 're-encode'

export interface RandomStartPayload {
  /**
   * Mỗi phần tử là 1 "bản ghép": danh sách file theo ĐÚNG thứ tự concat.
   * Mỗi bản >= 2 file và không trùng lặp trong cùng bản.
   */
  jobs: string[][]
  /** true = luôn chuẩn hoá + re-encode; false = tự động (copy nếu cùng chuẩn, khác chuẩn thì re-encode) */
  forceReencode: boolean
  /** thư mục xuất; rỗng = cạnh file đầu tiên của mỗi bản */
  outputDir?: string
  /** ID ổn định của draft khi chạy từng bản; backend dùng để chống enqueue trùng trong cùng phiên. */
  draftId?: string
}

/** Trả về danh sách taskId (mỗi bản ghép 1 task). */
export type RandomStartResult = string[]

export interface RandomThumbPayload {
  path: string
  /** mốc thời gian lấy frame (giây); bỏ trống = tự chọn ~10% thời lượng (tối đa 3s) */
  atSec?: number
}

/** data URI JPEG, vd 'data:image/jpeg;base64,...' */
export type RandomThumbResult = string
