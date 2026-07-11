import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { ChildProcess } from 'node:child_process'
import type { ModuleContext } from '../module-context'
import type { TaskApi } from '../task-queue'
import { releaseOutput } from '../util'
import { removeBackgroundRgba } from './photokey-engine'
import type {
  PhotokeyColor,
  PhotokeyOptions,
  PhotokeyReadImagePayload,
  PhotokeyReadImageResult,
  PhotokeyRemoveFolderPayload,
  PhotokeyRemoveFolderResult,
  PhotokeyRemovePayload,
  PhotokeyRemoveResult
} from '@shared/modules/photokey'

const IMAGE_MIME = new Map<string, string>([
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.webp', 'image/webp'],
  ['.bmp', 'image/bmp']
])

const MAX_PIXELS = 40_000_000
const STDERR_TAIL_LINES = 24
const PREVIEW_MAX_WIDTH = 960
const PREVIEW_TIMEOUT_MS = 20_000

function supportedImage(filePath: string): boolean {
  return IMAGE_MIME.has(path.extname(filePath).toLowerCase())
}

function requireImageFile(value: unknown): string {
  const filePath = typeof value === 'string' ? value.trim() : ''
  if (!filePath) throw new Error('Chưa chọn ảnh nguồn')
  if (!supportedImage(filePath)) {
    throw new Error('Định dạng ảnh không hỗ trợ — chỉ nhận PNG, JPG, JPEG, WebP hoặc BMP')
  }
  try {
    if (!fs.statSync(filePath).isFile()) throw new Error()
  } catch {
    throw new Error(`Ảnh nguồn không tồn tại hoặc không đọc được: ${filePath}`)
  }
  return filePath
}

function finiteOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function normalizeOptions(value: Partial<PhotokeyOptions> | undefined): PhotokeyOptions {
  const color: PhotokeyColor = value?.color === 'blue' ? 'blue' : 'green'
  const tolLow = clamp(finiteOr(value?.tolLow, 0.04), 0, 1)
  const tolHigh = clamp(finiteOr(value?.tolHigh, 0.16), 0, 1)
  if (tolHigh <= tolLow) {
    throw new Error('Ngưỡng trên phải lớn hơn ngưỡng dưới')
  }
  return {
    color,
    tolLow,
    tolHigh,
    choke: Math.round(clamp(finiteOr(value?.choke, 1), 0, 5)),
    feather: Math.round(clamp(finiteOr(value?.feather, 1), 0, 5)),
    despill: clamp(finiteOr(value?.despill, 1), 0, 1)
  }
}

function cancelled(api: TaskApi): boolean {
  return api.isCancelled()
}

function stderrMessage(lines: string[]): string {
  const tail = lines.join('\n')
  return tail.length > 4_000 ? tail.slice(-4_000) : tail
}

/** Chạy một giai đoạn FFmpeg, giữ stderr cuối và nối nút huỷ với process hiện tại. */
function runFfmpeg(
  ctx: ModuleContext,
  api: TaskApi,
  bin: string,
  args: string[],
  stage: string
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const stderr: string[] = []
    let child: ChildProcess
    let settled = false

    const finish = (error?: Error): void => {
      if (settled) return
      settled = true
      // Không để hook giữ PID của process đã thoát trong giai đoạn xử lý CPU.
      api.setCancelHook(() => {})
      api.update({ pid: undefined })
      if (error) reject(error)
      else resolve()
    }

    try {
      child = ctx.pm.spawnManaged(bin, args, {
        tag: 'ffmpeg',
        onLine: (line, stream) => {
          if (stream !== 'err') return
          const text = line.trim()
          if (!text) return
          stderr.push(text)
          if (stderr.length > STDERR_TAIL_LINES) stderr.shift()
        }
      }).child
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      finish(new Error(`Không thể chạy FFmpeg để ${stage}: ${message}`))
      return
    }

    api.update({ pid: child.pid })
    api.setCancelHook(() => ctx.pm.killTree(child.pid))
    child.once('error', (error) => {
      if (cancelled(api)) {
        finish()
        return
      }
      const tail = stderrMessage(stderr)
      finish(
        new Error(
          `Không thể chạy FFmpeg để ${stage}: ${error.message}${tail ? `\n${tail}` : ''}`
        )
      )
    })
    child.once('close', (code) => {
      if (cancelled(api)) {
        finish()
        return
      }
      if (code === 0) {
        finish()
        return
      }
      const tail = stderrMessage(stderr)
      finish(
        new Error(
          `FFmpeg ${stage} thoát mã ${code ?? 'không rõ'}${tail ? `:\n${tail}` : ''}`
        )
      )
    })
  })
}

/** Chạy FFmpeg một lần ngoài queue (preview) với timeout, giữ dòng stderr cuối để báo lỗi. */
function runFfmpegOnce(
  ctx: ModuleContext,
  bin: string,
  args: string[],
  purpose: string
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    let lastLine = ''
    const { child } = ctx.pm.spawnManaged(bin, args, {
      tag: 'ffmpeg',
      onLine: (line) => {
        const text = line.trim()
        if (text) lastLine = text
      }
    })
    const timer = setTimeout(() => {
      ctx.pm.killTree(child.pid)
      reject(new Error(`FFmpeg ${purpose} quá ${PREVIEW_TIMEOUT_MS / 1000} giây — đã huỷ`))
    }, PREVIEW_TIMEOUT_MS)
    child.once('error', (error) => {
      clearTimeout(timer)
      reject(new Error(`Không thể chạy FFmpeg để ${purpose}: ${error.message}`))
    })
    child.once('close', (code) => {
      clearTimeout(timer)
      if (code === 0) resolve()
      else {
        reject(
          new Error(`FFmpeg ${purpose} thoát mã ${code ?? 'không rõ'}${lastLine ? `: ${lastLine}` : ''}`)
        )
      }
    })
  })
}

function removeTemp(filePath: string): void {
  try {
    fs.rmSync(filePath, { force: true })
  } catch {
    /* file có thể đang bị antivirus giữ; không che lỗi xử lý chính */
  }
}

function enqueueImage(
  ctx: ModuleContext,
  src: string,
  outputDir: string | undefined,
  options: PhotokeyOptions
): PhotokeyRemoveResult {
  // deriveOutput yêu cầu phần mở rộng có dấu chấm và tự giữ chỗ để không ghi đè.
  const outPath = ctx.deriveOutput(src, '_background_removed', outputDir, '.png')
  try {
    const taskId = ctx.queue.add({
      type: 'photokey',
      title: path.basename(src),
      pool: 'misc',
      meta: { src, outputPath: outPath, ...options },
      onSettled: () => releaseOutput(outPath),
      run: async (api) => {
        const bin = ctx.resolveBin('ffmpeg')
        if (!bin) {
          throw new Error('Không tìm thấy FFmpeg — hãy tải binaries trong mục "Kiểm tra cập nhật"')
        }

        api.update({
          progress: 2,
          detail: 'Đang đọc thông tin ảnh...',
          outputPath: outPath
        })
        if (cancelled(api)) return

        const info = await ctx.probe(src)
        if (cancelled(api)) return
        const width = Math.trunc(info.video?.width ?? 0)
        const height = Math.trunc(info.video?.height ?? 0)
        if (width <= 0 || height <= 0) {
          throw new Error('Không đọc được chiều rộng/chiều cao của ảnh nguồn')
        }
        const pixelCount = width * height
        if (pixelCount > MAX_PIXELS) {
          throw new Error(
            `Ảnh quá lớn (${width}×${height}, hơn 40MP) — hãy thu nhỏ ảnh rồi thử lại`
          )
        }

        const token = `${process.pid}-${randomUUID()}`
        const tmpIn = path.join(os.tmpdir(), `ans-photokey-${token}-in.raw`)
        const tmpOut = path.join(os.tmpdir(), `ans-photokey-${token}-out.raw`)
        let completed = false
        try {
          api.update({ progress: 5, detail: 'Đang giải mã ảnh...' })
          await runFfmpeg(
            ctx,
            api,
            bin,
            [
              '-hide_banner',
              '-nostdin',
              '-y',
              '-i',
              src,
              '-frames:v',
              '1',
              '-f',
              'rawvideo',
              '-pix_fmt',
              'rgba',
              tmpIn
            ],
            'giải mã ảnh'
          )
          if (cancelled(api)) return
          api.update({ progress: 30, detail: 'Đã giải mã, đang xử lý pixel...' })

          const raw = await fs.promises.readFile(tmpIn)
          const expectedBytes = pixelCount * 4
          if (raw.byteLength !== expectedBytes) {
            throw new Error(
              `Dữ liệu ảnh giải mã không hợp lệ (${raw.byteLength}/${expectedBytes} byte)`
            )
          }
          if (cancelled(api)) return

          let lastStep = 0
          // Engine async: xử lý theo lát và nhả event loop nên UI/IPC/Cancel vẫn
          // phản hồi trong lúc chạy; checkCancel cho phép huỷ giữa chừng.
          const processed = await removeBackgroundRgba(
            raw,
            width,
            height,
            options,
            (step) => {
              const current = Math.trunc(step)
              if (
                current <= lastStep ||
                (current !== 2 && current !== 4 && current !== 5 && current !== 7)
              ) {
                return
              }
              lastStep = current
              api.update({
                progress: Math.round(30 + (current / 7) * 55),
                detail: `Xử lý pixel — bước ${current}/7`
              })
            },
            () => api.isCancelled()
          )
          if (processed.byteLength !== expectedBytes) {
            throw new Error(
              `Dữ liệu ảnh sau xử lý không hợp lệ (${processed.byteLength}/${expectedBytes} byte)`
            )
          }
          if (cancelled(api)) return
          await fs.promises.writeFile(tmpOut, processed)
          if (cancelled(api)) return

          api.update({ progress: 88, detail: 'Đang mã hóa PNG trong suốt...' })
          await runFfmpeg(
            ctx,
            api,
            bin,
            [
              '-hide_banner',
              '-nostdin',
              '-y',
              '-f',
              'rawvideo',
              '-pix_fmt',
              'rgba',
              '-s',
              `${width}x${height}`,
              '-i',
              tmpOut,
              '-frames:v',
              '1',
              // image2 muxer coi '%' trong tên file là pattern (%d) và ghi sai tên;
              // -update 1 buộc ghi đúng tên file theo nghĩa đen.
              '-update',
              '1',
              outPath
            ],
            'mã hóa PNG'
          )
          if (cancelled(api)) return
          if (!fs.existsSync(outPath)) throw new Error('FFmpeg không tạo được ảnh kết quả')
          completed = true
          api.update({ progress: 100, detail: 'Hoàn tất', outputPath: outPath })
        } finally {
          removeTemp(tmpIn)
          removeTemp(tmpOut)
          if (!completed) removeTemp(outPath)
        }
      }
    })
    // Hiển thị nút mở thư mục ngay cả khi task còn đang chờ pool misc.
    ctx.queue.patch(taskId, { outputPath: outPath })
    return { taskId, outPath }
  } catch (error) {
    releaseOutput(outPath)
    throw error
  }
}

function listImages(folder: unknown): { dir: string; files: string[] } {
  const dir = typeof folder === 'string' ? folder.trim() : ''
  if (!dir) throw new Error('Chưa chọn thư mục ảnh nguồn')
  let entries: fs.Dirent[]
  try {
    if (!fs.statSync(dir).isDirectory()) throw new Error()
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    throw new Error(`Thư mục ảnh không tồn tại hoặc không đọc được: ${dir}`)
  }
  const files = entries
    .filter((entry) => entry.isFile() && supportedImage(entry.name))
    .map((entry) => path.join(dir, entry.name))
    .sort((a, b) => a.localeCompare(b))
  if (!files.length) {
    throw new Error('Thư mục không có ảnh hỗ trợ (.png, .jpg, .jpeg, .webp, .bmp)')
  }
  return { dir, files }
}

export default function register(ctx: ModuleContext): void {
  ctx.handle('mod:photokey:remove', async (payload: PhotokeyRemovePayload) => {
    const src = requireImageFile(payload?.src)
    const options = normalizeOptions(payload)
    const outputDir = payload?.outputDir?.trim() || undefined
    return enqueueImage(ctx, src, outputDir, options)
  })

  ctx.handle('mod:photokey:remove-folder', async (payload: PhotokeyRemoveFolderPayload) => {
    const { dir, files } = listImages(payload?.dir)
    const options = normalizeOptions(payload)
    const outputDir = payload?.outputDir?.trim() || undefined
    const taskIds: string[] = []
    for (const src of files) {
      taskIds.push(enqueueImage(ctx, src, outputDir, options).taskId)
    }
    const result: PhotokeyRemoveFolderResult = {
      count: files.length,
      taskIds,
      outDir: outputDir ?? dir
    }
    return result
  })

  ctx.handle('mod:photokey:read-image', async (payload: PhotokeyReadImagePayload) => {
    const filePath = requireImageFile(payload?.path)
    const bin = ctx.resolveBin('ffmpeg')
    if (!bin) {
      throw new Error('Không tìm thấy FFmpeg — hãy tải binaries trong mục "Kiểm tra cập nhật"')
    }
    // Thu nhỏ về tối đa 960px (giống preview của green-screen) thay vì base64
    // nguyên ảnh gốc: tránh bơm data URL hàng trăm MB qua IPC vào renderer.
    const tmpPng = path.join(
      os.tmpdir(),
      `ans-photokey-preview-${process.pid}-${randomUUID()}.png`
    )
    try {
      await runFfmpegOnce(
        ctx,
        bin,
        [
          '-hide_banner',
          '-nostdin',
          '-y',
          '-i',
          filePath,
          '-vf',
          `scale=w='min(${PREVIEW_MAX_WIDTH},iw)':h=-1`,
          '-frames:v',
          '1',
          '-update',
          '1',
          tmpPng
        ],
        'tạo ảnh xem trước'
      )
      const data = await fs.promises.readFile(tmpPng)
      const result: PhotokeyReadImageResult = {
        dataUrl: `data:image/png;base64,${data.toString('base64')}`
      }
      return result
    } finally {
      removeTemp(tmpPng)
    }
  })
}
