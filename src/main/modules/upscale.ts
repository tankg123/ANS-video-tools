import { execFile } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type {
  UpscaleEngineStatus,
  UpscaleStartPayload,
  UpscaleStartResult
} from '@shared/modules/upscale'
import { enqueueFetchRealesrgan, resolveRealesrgan } from '../binaries'
import { logger } from '../logger'
import type { ModuleContext } from '../module-context'
import { parseFfmpegLine } from '../progress-parser'
import { encoderQualityArgs, MP4_SAFE_AUDIO, releaseOutput } from '../util'

/** Đếm file khung hình theo đuôi trong thư mục (thư mục chưa tồn tại / lỗi đọc → 0) */
function countFrames(dir: string, ext: string): number {
  const suffix = '.' + ext
  try {
    return fs.readdirSync(dir).filter((f) => f.toLowerCase().endsWith(suffix)).length
  } catch {
    return 0
  }
}

/**
 * Luồng nạp/lưu ảnh cho realesrgan-ncnn-vulkan (-j load:proc:save, mặc định của tool
 * là 1:2:2): tăng theo số nhân CPU để GPU không phải chờ decode/encode ảnh — trên máy
 * nhiều nhân đây là nút thắt lớn thứ hai sau chính GPU.
 */
function ioThreads(): number {
  return Math.min(8, Math.max(2, Math.floor(os.cpus().length / 4)))
}

type UpscaleKv = ReturnType<ModuleContext['kv']>

/**
 * Dọn thư mục PNG tạm mồ côi từ phiên trước: app crash / mất điện giữa chừng AI upscale
 * có thể bỏ lại hàng chục-trăm GB trong .vt-tmp/upscale_* (hoặc os.tmpdir fallback).
 * Danh sách thư mục được ghi vào kv khi task tạo tmp; lúc register() chưa có task nào
 * chạy nên mọi entry còn sót đều là rác.
 */
function sweepStaleTmpDirs(kv: UpscaleKv): void {
  const stale = kv.get<string[]>('tmpDirs', [])
  if (!stale.length) return
  const remain: string[] = []
  for (const dir of stale) {
    try {
      fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 })
    } catch {
      remain.push(dir) // vẫn kẹt (handle/ổ đĩa rời) — giữ lại để phiên sau thử tiếp
    }
  }
  kv.set('tmpDirs', remain)
}

const REALESRGAN_IMAGE = 'realesrgan-ncnn-vulkan.exe'

/**
 * Kill process realesrgan mồ côi từ phiên trước: orphanCleanup của core chỉ nhận diện
 * ffmpeg/ffprobe/yt-dlp nên module tự lưu PID qua kv, và xác minh đúng tên image bằng
 * tasklist (tránh kill nhầm PID đã bị hệ điều hành tái sử dụng) trước khi kill.
 */
function killStaleRealesrganPids(kv: UpscaleKv, pm: ModuleContext['pm']): void {
  const stale = kv.get<number[]>('aiPids', [])
  if (!stale.length) return
  kv.set('aiPids', [])
  if (process.platform !== 'win32') return
  for (const pid of stale) {
    execFile(
      'tasklist',
      ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'],
      { windowsHide: true },
      (_err, stdout) => {
        const m = (stdout ?? '').toString().match(/^"([^"]+)"/m)
        if (m && m[1].toLowerCase() === REALESRGAN_IMAGE) pm.killTree(pid)
      }
    )
  }
}

/**
 * Module Nâng cấp 4K (Upscale):
 * - Engine 'fast': 1 lệnh FFmpeg — Lanczos + CAS sharpening (nhanh, chất lượng khá).
 *   Cú pháp filter 'scale=...:flags=lanczos,cas=0.45' đã xác minh với bin/ffmpeg.exe.
 * - Engine 'realesrgan': pipeline 3 giai đoạn trong MỘT task (rã khung hình → AI upscale
 *   từng khung bằng realesrgan-ncnn-vulkan → nén lại + ghép audio gốc).
 *   Tối ưu tốc độ: khung trung gian JPG q=2 mặc định (nhẹ đĩa ~6 lần so với PNG),
 *   -j nhiều luồng nạp/lưu ảnh, tuỳ chọn tile size theo VRAM, tuỳ chọn giảm FPS.
 *   LƯU Ý dung lượng đĩa tạm: JPG ~1-2MB/khung, PNG ~2-8MB/khung (khung đã upscale còn
 *   lớn hơn) — video dài có thể chiếm hàng chục GB trong .vt-tmp (dọn ở finally).
 */
export default function register(ctx: ModuleContext): void {
  const kv = ctx.kv('upscale')
  // Dọn rác phiên trước ngay khi khởi động: thư mục PNG tạm mồ côi + process realesrgan
  // mồ côi (app crash / mất điện giữa chừng một AI upscale nhiều giờ)
  sweepStaleTmpDirs(kv)
  killStaleRealesrganPids(kv, ctx.pm)

  const addAiPid = (pid: number): void => {
    kv.set('aiPids', [...kv.get<number[]>('aiPids', []).filter((x) => x !== pid), pid])
  }
  const removeAiPid = (pid: number): void => {
    kv.set('aiPids', kv.get<number[]>('aiPids', []).filter((x) => x !== pid))
  }

  ctx.handle('mod:upscale:engineStatus', async (): Promise<UpscaleEngineStatus> => {
    const r = resolveRealesrgan()
    return { installed: !!r, exePath: r?.exe ?? null, modelsDir: r?.modelsDir ?? null }
  })

  ctx.handle('mod:upscale:fetchEngine', async () => enqueueFetchRealesrgan())

  ctx.handle('mod:upscale:start', async (p: UpscaleStartPayload): Promise<UpscaleStartResult> => {
    if (!Array.isArray(p?.inputs) || p.inputs.length === 0) throw new Error('Chưa chọn video nào')
    if (p.engine !== 'fast' && p.engine !== 'realesrgan') throw new Error('Engine upscale không hợp lệ')
    if (p.codec !== 'h264' && p.codec !== 'hevc') throw new Error('Codec đầu ra không hợp lệ')
    if (p.target !== 1440 && p.target !== 2160) throw new Error('Độ phân giải đích không hợp lệ')
    if (p.frameFormat !== undefined && p.frameFormat !== 'jpg' && p.frameFormat !== 'png') {
      throw new Error('Định dạng khung hình tạm không hợp lệ')
    }
    if (p.tileSize !== undefined && ![0, 256, 512].includes(p.tileSize)) {
      throw new Error('Tile size không hợp lệ')
    }
    if (p.fpsLimit !== undefined && ![0, 24, 30].includes(p.fpsLimit)) {
      throw new Error('Giới hạn FPS không hợp lệ')
    }
    if (
      p.engine === 'realesrgan' &&
      !['realesrgan-x4plus', 'realesrgan-x4plus-anime', 'realesr-animevideov3'].includes(p.model)
    ) {
      throw new Error('Model AI không hợp lệ')
    }

    // Engine AI phải sẵn sàng TRƯỚC khi enqueue bất kỳ file nào
    const engine = p.engine === 'realesrgan' ? resolveRealesrgan() : null
    if (p.engine === 'realesrgan' && !engine) {
      throw new Error('Chưa cài engine AI — bấm "Tải engine AI" trong module')
    }

    const enc = await ctx.pickEncoder(p.codec)
    const quality = encoderQualityArgs(enc, p.codec === 'hevc' ? 21 : 19)
    const hevcTag = p.codec === 'hevc' ? ['-tag:v', 'hvc1'] : []
    const label = p.target === 2160 ? '4K' : '2K'

    const taskIds: string[] = []
    const errors: { input: string; error: string }[] = []

    // deriveOutput giữ chỗ toàn cục cho cả task queued/running để tránh trùng basename.
    const deriveUnique = (input: string, suffix: string): string => {
      return ctx.deriveOutput(input, suffix, p.outputDir, '.mp4')
    }

    // Xử lý TỪNG input độc lập — file lỗi dồn vào errors, không chặn file khác
    for (const input of p.inputs) {
      try {
        const info = await ctx.probe(input)
        if (!info.video) throw new Error('File không có luồng video')
        const w = info.video.width
        const h = info.video.height
        if (!w || !h) throw new Error('Không đọc được kích thước video')
        if (Math.min(w, h) >= p.target) throw new Error('Video đã đạt/vượt độ phân giải đích')

        const fps = info.video.fps || 30
        const dur = info.durationSec
        // Giảm FPS đầu ra (tuỳ chọn) — chỉ khi thấp hơn FPS nguồn; 60→30 nghĩa là
        // AI chỉ phải xử lý một nửa số khung hình
        const fpsLimit = p.fpsLimit && p.fpsLimit > 0 && p.fpsLimit < fps ? p.fpsLimit : 0
        // Cạnh NGẮN đạt target — chọn hướng NGAY TRONG filter theo khung ĐÃ giải mã
        // (iw/ih): ffmpeg tự xoay khung theo rotation metadata TRƯỚC -vf, nên không được
        // chọn hướng từ width/height của probe (video điện thoại quay dọc lưu
        // 1920x1080 + rotate=90 sẽ scale sai cạnh). '-2' để cạnh còn lại tự tính và
        // luôn chẵn — yêu cầu của yuv420p. Đã xác minh với bin/ffmpeg.exe.
        const scaleExpr = `scale=w='if(gte(iw,ih),-2,${p.target})':h='if(gte(iw,ih),${p.target},-2)'`
        const output = deriveUnique(input, '_' + (p.target === 2160 ? '4k' : '2k'))
        const audioArgs =
          info.audio && MP4_SAFE_AUDIO.has((info.audio.codec || '').toLowerCase())
            ? ['-c:a', 'copy']
            : ['-c:a', 'aac', '-b:a', '192k']

        if (p.engine === 'fast') {
          taskIds.push(
            ctx.enqueueFfmpeg({
              type: 'upscale',
              title: `Upscale ${label}: ${path.basename(input)}`,
              args: [
                '-i', input,
                '-map', '0:v:0', '-map', '0:a:0?',
                '-vf', `${fpsLimit ? `fps=${fpsLimit},` : ''}${scaleExpr}:flags=lanczos,cas=0.45`,
                '-c:v', enc, ...quality,
                '-pix_fmt', 'yuv420p',
                ...hevcTag,
                '-movflags', '+faststart',
                ...audioArgs,
                output
              ],
              durationSec: dur,
              outputPath: output,
              meta: { engine: 'fast', mode: 're-encode', target: p.target }
            })
          )
          continue
        }

        // ---------- Engine 'realesrgan': 3 giai đoạn trong MỘT task ----------
        if (!engine) throw new Error('Chưa cài engine AI — bấm "Tải engine AI" trong module')
        const { exe, modelsDir } = engine
        const model = p.model
        // JPG q=2 gần như không phân biệt được bằng mắt so với PNG nhưng nhẹ đĩa ~6 lần
        // → cả 3 giai đoạn đều nhanh hơn rõ (đọc/ghi ít hơn); 'png' cho ai cần lossless.
        const frameExt = p.frameFormat === 'png' ? 'png' : 'jpg'
        // Scale factor: animevideov3 hỗ trợ x2/x3/x4 → chọn vừa đủ đạt target;
        // x4plus / x4plus-anime chỉ có x4 (giai đoạn C sẽ hạ về đúng target nếu dư)
        const s =
          model === 'realesr-animevideov3'
            ? Math.min(4, Math.max(2, Math.ceil(p.target / Math.min(w, h))))
            : 4

        taskIds.push(
          ctx.queue.add({
            type: 'upscale',
            pool: 'ffmpeg',
            title: `Upscale ${label} AI: ${path.basename(input)}`,
            meta: { engine: 'realesrgan', model, mode: 're-encode', target: p.target, frameFormat: frameExt, fpsLimit },
            onSettled: () => releaseOutput(output),
            run: async (api) => {
              const ffmpegBin = ctx.resolveBin('ffmpeg')
              if (!ffmpegBin) {
                throw new Error('Không tìm thấy FFmpeg — hãy tải binaries trong mục "Kiểm tra cập nhật"')
              }
              const log = logger.create(api.id)
              api.update({ logFile: log.file, outputPath: output, progress: 0, detail: 'Chuẩn bị...' })

              // Thư mục tạm cùng ổ đĩa với output (spec 5.5). LƯU Ý: pattern image2 của
              // ffmpeg coi '%' là ký tự format — nếu đường dẫn đích chứa '%' (tên file gốc
              // có '%'), chuyển tmp sang os.tmpdir() để '%08d.png' không bị phá
              // (đánh đổi: tmp có thể khác ổ đĩa với output).
              const outParent = path.dirname(output)
              const tmpBase = outParent.includes('%')
                ? path.join(os.tmpdir(), 'vt-upscale_' + api.id)
                : path.join(outParent, '.vt-tmp', 'upscale_' + api.id)
              const inDir = path.join(tmpBase, 'in')
              const framesDir = path.join(tmpBase, 'out')
              fs.mkdirSync(inDir, { recursive: true })
              fs.mkdirSync(framesDir, { recursive: true })
              // Giữ sổ tmpBase trong kv — nếu app crash / mất điện giữa chừng thì
              // sweepStaleTmpDirs() dọn ở lần khởi động sau (gạch sổ ở finally bên dưới)
              kv.set('tmpDirs', [...kv.get<string[]>('tmpDirs', []), tmpBase])

              // Helper chung: chạy 1 process, user bấm dừng → kill cả cây.
              // trackAiPid: realesrgan không nằm trong OUR_IMAGES của orphanCleanup core
              // → tự lưu PID vào kv để killStaleRealesrganPids() xử lý nếu app crash.
              const runStage = (
                stage: string,
                bin: string,
                args: string[],
                onLine: (line: string) => void,
                trackAiPid = false
              ): Promise<void> =>
                new Promise<void>((resolve, reject) => {
                  let lastLine = ''
                  const { child } = ctx.pm.spawnManaged(bin, args, {
                    tag: 'ffmpeg',
                    onLine: (line) => {
                      if (line.trim()) lastLine = line.trim()
                      onLine(line)
                    }
                  })
                  if (trackAiPid && child.pid) addAiPid(child.pid)
                  api.update({ pid: child.pid })
                  api.setCancelHook(() => ctx.pm.killTree(child.pid))
                  child.on('error', (e) => reject(e))
                  child.on('close', (code) => {
                    if (trackAiPid && child.pid) removeAiPid(child.pid)
                    if (code !== 0 && !api.isCancelled()) {
                      reject(new Error(`${stage} thoát mã ${code}: ${lastLine}`))
                    } else {
                      resolve()
                    }
                  })
                })

              try {
                // ----- Giai đoạn A (0→15%): rã khung hình (JPG q=2 mặc định / PNG) -----
                const aArgs = [
                  '-hide_banner', '-nostdin', '-y',
                  '-i', input,
                  ...(fpsLimit ? ['-vf', `fps=${fpsLimit}`] : []),
                  ...(frameExt === 'jpg' ? ['-qscale:v', '2'] : []),
                  path.join(inDir, `%08d.${frameExt}`)
                ]
                log.write(`CMD: ffmpeg ${aArgs.join(' ')}`)
                api.update({ detail: 'Rã khung hình...' })
                await runStage('Rã khung hình', ffmpegBin, aArgs, (line) => {
                  log.write(line)
                  const prog = parseFfmpegLine(line)
                  if (prog && dur > 0) {
                    api.update({
                      progress: Math.min(1, prog.timeSec / dur) * 15,
                      detail: 'Rã khung hình...'
                    })
                  }
                })
                if (api.isCancelled()) return

                const totalFrames = countFrames(inDir, frameExt)
                if (!totalFrames) throw new Error('Không rã được khung hình nào từ video')

                // ----- Giai đoạn B (15→85%): AI upscale từng khung -----
                // -j load:proc:save — nhiều luồng nạp/lưu để GPU không chờ I/O ảnh
                const io = ioThreads()
                const bArgs = [
                  '-i', inDir, '-o', framesDir,
                  '-n', model, '-s', String(s),
                  '-f', frameExt,
                  '-m', modelsDir,
                  '-j', `${io}:2:${io}`,
                  ...(p.tileSize ? ['-t', String(p.tileSize)] : [])
                ]
                log.write(`CMD: ${path.basename(exe)} ${bArgs.join(' ')}`)
                api.update({ progress: 15, detail: `AI upscale 0/${totalFrames} khung` })
                let lastDone = 0
                let lastAt = Date.now()
                const timer = setInterval(() => {
                  const done = countFrames(framesDir, frameExt)
                  const now = Date.now()
                  const rate = (done - lastDone) / Math.max(0.25, (now - lastAt) / 1000)
                  lastDone = done
                  lastAt = now
                  api.update({
                    progress: 15 + 70 * Math.min(1, done / totalFrames),
                    detail: `AI upscale ${done}/${totalFrames} khung`,
                    speed: rate > 0 ? `${rate.toFixed(1)} khung/s` : undefined
                  })
                }, 1000)
                try {
                  // stderr của ncnn in % theo tile — chỉ ghi log, không parse
                  await runStage('AI upscale', exe, bArgs, (line) => log.write(line), true)
                } finally {
                  clearInterval(timer)
                }
                if (api.isCancelled()) return
                const outputFrames = countFrames(framesDir, frameExt)
                if (outputFrames !== totalFrames) {
                  throw new Error(
                    `Engine AI tạo thiếu khung hình (${outputFrames}/${totalFrames}) — kiểm tra GPU/driver Vulkan (xem log)`
                  )
                }

                // ----- Giai đoạn C (85→100%): nén khung hình + audio gốc thành MP4 -----
                // Framerate tái dựng CHÍNH XÁC = số khung / thời lượng: fps từ probe bị
                // làm tròn 2 chữ số (23.98 thay vì 24000/1001) → video dài lệch A/V dồn
                // dần; cách này cũng tự đúng với nguồn VFR và khi đã giảm FPS ở giai
                // đoạn A. KHÔNG dùng '-shortest': audio ngắn hơn video sẽ cắt mất khung
                // cuối (mp4 chấp nhận 2 luồng lệch độ dài — engine 'fast' cũng vậy).
                const cFramerate = dur > 0 ? totalFrames / dur : (fpsLimit || fps)
                const cArgs = [
                  '-hide_banner', '-nostdin', '-y',
                  '-framerate', String(cFramerate),
                  '-i', path.join(framesDir, `%08d.${frameExt}`),
                  '-i', input,
                  '-map', '0:v:0', '-map', '1:a:0?',
                  '-vf', `${scaleExpr}:flags=lanczos`,
                  '-c:v', enc, ...quality,
                  '-pix_fmt', 'yuv420p',
                  ...hevcTag,
                  '-movflags', '+faststart',
                  ...audioArgs,
                  output
                ]
                log.write(`CMD: ffmpeg ${cArgs.join(' ')}`)
                api.update({ progress: 85, detail: `Nén video ${label}...`, speed: undefined })
                await runStage('Nén video', ffmpegBin, cArgs, (line) => {
                  log.write(line)
                  const prog = parseFfmpegLine(line)
                  if (prog && dur > 0) {
                    api.update({
                      progress: 85 + Math.min(1, prog.timeSec / dur) * 15,
                      detail: `Nén video ${label}...`,
                      speed: prog.speed ? `${prog.speed}x` : undefined
                    })
                  }
                })
              } finally {
                log.close()
                // Dọn PNG tạm kể cả khi lỗi/huỷ. Windows có thể còn giữ handle thoáng qua
                // ngay sau kill → maxRetries; force để không ném lỗi đè lên lỗi gốc.
                // Xoá xong mới gạch sổ kv — nếu vẫn kẹt thì giữ entry để phiên sau
                // sweepStaleTmpDirs() dọn tiếp.
                try {
                  fs.rmSync(tmpBase, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 })
                  kv.set('tmpDirs', kv.get<string[]>('tmpDirs', []).filter((d) => d !== tmpBase))
                } catch {
                  /* ignore — entry còn trong kv, phiên sau dọn */
                }
              }
            }
          })
        )
      } catch (e) {
        errors.push({ input, error: e instanceof Error ? e.message : String(e) })
      }
    }

    return { taskIds, errors }
  })
}
