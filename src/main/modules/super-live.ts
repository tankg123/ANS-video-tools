import fs from 'node:fs'
import path from 'node:path'
import type {
  SuperLiveStartPayload,
  SuperLiveStopPayload,
  SuperLiveStream
} from '@shared/modules/super-live'
import type { MediaInfo } from '@shared/types'
import { logger } from '../logger'
import type { ModuleContext } from '../module-context'
import { parseFfmpegLine } from '../progress-parser'

/** Số file tối đa sẽ probe khi nguồn là thư mục — quá cap coi như không đồng nhất */
const PROBE_CAP = 100

/** Sentinel đánh dấu luồng đang khởi tạo (chưa có taskId) — chặn double-start */
const PENDING = '__pending__'

/**
 * Module Super Live Stream (spec 4.1):
 * - Nhiều luồng RTMP song song (pool 'live', giới hạn settings.maxLive)
 * - Nguồn: file đơn hoặc THƯ MỤC (concat demuxer, tuỳ chọn shuffle)
 * - '-c copy' khi nguồn đã chuẩn H264+AAC → CPU ~0%; ngược lại x264/NVENC
 * - Tự restart khi ffmpeg rớt (tối đa 10 lần liên tiếp, chờ 5s/lần)
 * - Hẹn giờ bắt đầu/kết thúc: task tạo ngay, chờ trong run() (cách đơn giản)
 */
export default function register(ctx: ModuleContext): void {
  const kv = ctx.kv('super-live')
  /** streamId -> taskId của task đang chạy/chờ gần nhất (hoặc PENDING khi đang khởi tạo) */
  const running = new Map<string, string>()

  const getStreams = (): SuperLiveStream[] => kv.get<SuperLiveStream[]>('streams', [])

  const isActive = (streamId: string): boolean => {
    const taskId = running.get(streamId)
    if (!taskId) return false
    if (taskId === PENDING) return true // đang khởi tạo (probe/pickEncoder) — coi như active
    const info = ctx.queue.get(taskId)
    return !!info && (info.status === 'queued' || info.status === 'running')
  }

  ctx.handle('mod:super-live:list', async () => getStreams())

  ctx.handle('mod:super-live:save', async (streams: SuperLiveStream[]) => {
    if (!Array.isArray(streams)) throw new Error('Dữ liệu luồng không hợp lệ')
    kv.set('streams', streams)
    return true
  })

  ctx.handle('mod:super-live:stop', async (p: SuperLiveStopPayload) => {
    const taskId = running.get(p.id)
    if (taskId && taskId !== PENDING) ctx.queue.cancel(taskId)
    return true
  })

  ctx.handle('mod:super-live:start', async (p: SuperLiveStartPayload) => {
    const stream = getStreams().find((s) => s.id === p.id)
    if (!stream) throw new Error('Không tìm thấy cấu hình luồng')
    if (isActive(stream.id)) throw new Error(`Luồng "${stream.name}" đang chạy`)
    if (!stream.source?.trim()) throw new Error('Chưa chọn nguồn video')
    if (!stream.rtmpUrl?.trim()) throw new Error('Chưa nhập RTMP URL')

    // Giữ chỗ ĐỒNG BỘ trước await đầu tiên — 2 lời gọi start liên tiếp không cùng lọt qua guard
    running.set(stream.id, PENDING)
    try {
      // Xác minh nguồn tồn tại + là file hay thư mục (không tin isFolder từ UI)
      let isFolder: boolean
      try {
        isFolder = fs.statSync(stream.source).isDirectory()
      } catch {
        throw new Error(`Nguồn video không tồn tại: ${stream.source}`)
      }
      let firstFile = stream.source
      if (isFolder) {
        const files = ctx.scanVideoDir(stream.source)
        if (!files.length) throw new Error('Thư mục không chứa file video nào')
        firstFile = files[0]
      }

      // Hẹn giờ
      const startAt = stream.scheduleStart ? Date.parse(stream.scheduleStart) : NaN
      const endAt = stream.scheduleEnd ? Date.parse(stream.scheduleEnd) : NaN
      const hasStart = Number.isFinite(startAt) && startAt > Date.now()
      const hasEnd = Number.isFinite(endAt)
      if (hasEnd && endAt <= Date.now()) throw new Error('Giờ kết thúc đã qua — hãy sửa lịch hẹn')
      if (hasEnd && hasStart && endAt <= startAt) throw new Error('Giờ kết thúc phải sau giờ bắt đầu')

      // Quyết định chế độ encode
      const needScale = !!stream.resolution
      let effEncoder: 'copy' | 'x264' | 'hw' = stream.encoder ?? 'copy'
      let copyHint: string | undefined
      if (effEncoder === 'copy' && needScale) effEncoder = 'x264' // đổi độ phân giải buộc re-encode
      if (effEncoder === 'copy') {
        if (!isFolder) {
          const info = await ctx.probe(firstFile)
          const vOk = info.video?.codec?.toLowerCase() === 'h264'
          const aOk = !info.audio || info.audio.codec?.toLowerCase() === 'aac'
          if (!vOk || !aOk) {
            effEncoder = 'x264' // nguồn không chuẩn H264+AAC → tự chuyển x264
            copyHint = 'Nguồn không chuẩn H264+AAC → tự chuyển re-encode x264'
          }
        } else {
          // Thư mục: probe TOÀN BỘ file (cap 100) — copy chỉ khi tất cả H264+AAC, cùng kích thước & fps
          const files = ctx.scanVideoDir(stream.source)
          let reason: string | undefined
          if (files.length > PROBE_CAP) {
            reason = `thư mục có ${files.length} file (> ${PROBE_CAP}) — không kiểm tra được tính đồng nhất`
          } else {
            let ref: { width: number; height: number; fps: number } | undefined
            for (const f of files) {
              let info: MediaInfo
              try {
                info = await ctx.probe(f)
              } catch {
                reason = `không đọc được thông tin "${path.basename(f)}"`
                break
              }
              const vOk = info.video?.codec?.toLowerCase() === 'h264'
              const aOk = !info.audio || info.audio.codec?.toLowerCase() === 'aac'
              if (!vOk || !aOk || !info.video) {
                reason = `"${path.basename(f)}" không chuẩn H264+AAC`
                break
              }
              if (!ref) {
                ref = { width: info.video.width, height: info.video.height, fps: info.video.fps }
              } else if (
                info.video.width !== ref.width ||
                info.video.height !== ref.height ||
                Math.abs(info.video.fps - ref.fps) >= 0.5
              ) {
                reason = `"${path.basename(f)}" khác kích thước/fps với file đầu`
                break
              }
            }
          }
          if (reason) {
            effEncoder = 'x264' // nguồn không đồng nhất → ép re-encode cho concat an toàn
            copyHint = `Copy → re-encode: ${reason}`
          }
        }
      }

      const mode: 'copy' | 're-encode' = effEncoder === 'copy' ? 'copy' : 're-encode'
      const br = Math.max(200, Math.round(stream.bitrate || 4000))
      let codecArgs: string[]
      if (effEncoder === 'copy') {
        codecArgs = ['-c', 'copy']
      } else {
        const enc = effEncoder === 'hw' ? await ctx.pickEncoder('h264') : 'libx264'
        codecArgs = [
          ...(needScale ? ['-vf', `scale=-2:${stream.resolution}`] : []),
          '-c:v', enc,
          ...(enc === 'libx264' ? ['-preset', 'veryfast'] : []),
          '-b:v', `${br}k`,
          '-maxrate', `${br}k`,
          '-bufsize', `${br * 2}k`,
          '-pix_fmt', 'yuv420p',
          '-g', '60',
          '-c:a', 'aac', '-b:a', '128k', '-ar', '44100'
        ]
      }

      const url = stream.rtmpUrl.trim().replace(/\/+$/, '')
      const key = stream.streamKey?.trim() ?? ''
      const dest = key ? `${url}/${key}` : url

      /** Args cho 1 lần spawn — dựng lại mỗi lần restart để shuffle xáo trộn lại danh sách */
      const buildArgs = (): string[] => {
        let inputArgs: string[]
        if (isFolder) {
          let files = ctx.scanVideoDir(stream.source)
          if (!files.length) throw new Error('Thư mục không còn file video nào')
          if (stream.shuffle) files = shuffleArray(files)
          const content = files.map((f) => `file '${ctx.concatEscape(f)}'`).join('\n')
          const listFile = ctx.writeTempFile(files[0], `superlive-${stream.id}.txt`, content)
          inputArgs = [
            '-f', 'concat', '-safe', '0',
            ...(stream.loop ? ['-stream_loop', '-1'] : []),
            '-re', '-i', listFile
          ]
        } else {
          inputArgs = ['-re', ...(stream.loop ? ['-stream_loop', '-1'] : []), '-i', stream.source]
        }
        return [...inputArgs, ...codecArgs, '-f', 'flv', dest]
      }

      const baseMeta = { streamId: stream.id, mode, ...(copyHint ? { hint: copyHint } : {}) }
      const title = `Live: ${stream.name?.trim() || path.basename(stream.source)}`

      const taskId = ctx.queue.add({
        type: 'super-live',
        title,
        pool: 'live',
        meta: { ...baseMeta, waiting: hasStart },
        run: async (api) => {
          const bin = ctx.resolveBin('ffmpeg')
          if (!bin) throw new Error('Không tìm thấy FFmpeg — hãy tải binaries trong mục "Kiểm tra cập nhật"')
          const log = logger.create(api.id)
          api.update({ logFile: log.file, progress: -1 })
          try {
            if (copyHint) log.write(copyHint)
            // 1) Chờ đến giờ hẹn (nếu có) — cách đơn giản: chờ ngay trong task
            if (hasStart) {
              api.update({ detail: 'Chờ đến giờ...', meta: { ...baseMeta, waiting: true } })
              log.write(`Đã hẹn giờ — chờ đến ${new Date(startAt).toLocaleString()}`)
              while (Date.now() < startAt) {
                if (api.isCancelled()) return
                await sleep(1000)
              }
              api.update({ meta: { ...baseMeta, waiting: false }, detail: 'Bắt đầu phát...' })
            }
            if (api.isCancelled()) return

            // 2) Hẹn giờ kết thúc → kill process đang chạy khi đến giờ
            let endedBySchedule = false
            let currentPid: number | undefined
            let endTimer: ReturnType<typeof setTimeout> | null = null
            if (hasEnd) {
              const ms = endAt - Date.now()
              if (ms <= 0) throw new Error('Giờ kết thúc đã qua')
              endTimer = setTimeout(() => {
                endedBySchedule = true
                log.write('Đã đến giờ kết thúc theo lịch hẹn — dừng luồng.')
                ctx.pm.killTree(currentPid)
              }, ms)
            }

            // 3) Vòng phát + tự restart khi rớt (max 10 lần liên tiếp)
            let attempts = 0
            try {
              for (;;) {
                // đến giờ kết thúc / bị huỷ trong lúc chờ reconnect → không respawn
                if (api.isCancelled() || endedBySchedule) break
                const fullArgs = ['-hide_banner', '-nostdin', ...buildArgs()]
                log.write(`CMD: ffmpeg ${fullArgs.join(' ')}`)
                const spawnAt = Date.now()
                const code = await new Promise<number>((resolve, reject) => {
                  const { child } = ctx.pm.spawnManaged(bin, fullArgs, {
                    onLine: (line) => {
                      log.write(line)
                      const prog = parseFfmpegLine(line)
                      if (prog) {
                        api.update({
                          speed: prog.speed ? `${prog.speed}x` : undefined,
                          detail:
                            [prog.fps ? `${prog.fps} fps` : '', prog.bitrate ?? '']
                              .filter(Boolean)
                              .join(' · ') || undefined
                        })
                      }
                    }
                  })
                  currentPid = child.pid
                  api.update({ pid: child.pid })
                  api.setCancelHook(() => ctx.pm.killTree(child.pid))
                  child.on('error', (e) => reject(e))
                  child.on('close', (c) => resolve(c ?? -1))
                })

                if (api.isCancelled() || endedBySchedule) break
                if (code === 0) {
                  log.write('FFmpeg kết thúc bình thường (hết nguồn phát).')
                  break
                }
                // rớt mạng / ffmpeg lỗi → chờ 5s rồi spawn lại
                if (Date.now() - spawnAt > 60_000) attempts = 0 // chạy ổn định >60s → reset đếm
                attempts++
                if (attempts > 10) {
                  throw new Error(`Mất kết nối — đã thử lại 10 lần không thành công (mã thoát ${code})`)
                }
                log.write(`FFmpeg thoát mã ${code} — thử kết nối lại sau 5s (lần ${attempts}/10)`)
                api.update({ detail: `Reconnecting... (${attempts}/10)`, speed: undefined, progress: -1 })
                const waitUntil = Date.now() + 5000
                while (Date.now() < waitUntil && !api.isCancelled() && !endedBySchedule) await sleep(500)
                if (api.isCancelled() || endedBySchedule) break
              }
            } finally {
              if (endTimer) clearTimeout(endTimer)
            }
          } finally {
            log.close()
          }
        }
      })

      running.set(stream.id, taskId)
      return taskId
    } catch (e) {
      // khởi tạo thất bại → nhả chỗ giữ để có thể start lại
      if (running.get(stream.id) === PENDING) running.delete(stream.id)
      throw e
    }
  })
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** Fisher–Yates shuffle (không mutate mảng gốc) */
function shuffleArray<T>(arr: T[]): T[] {
  const out = [...arr]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}
