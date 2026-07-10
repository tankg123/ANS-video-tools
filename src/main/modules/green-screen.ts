import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { encoderQualityArgs, MP4_SAFE_AUDIO } from '../util'
import type { ModuleContext } from '../module-context'
import type {
  GreenScreenParams,
  GreenScreenPreviewPayload,
  GreenScreenStartPayload
} from '@shared/modules/green-screen'

/**
 * Module Chèn Phông Xanh (spec 4.7):
 * - filter_complex: scale overlay → chromakey → overlay lên nền
 * - Luôn re-encode (chromakey không thể -c copy), audio copy từ nền nếu hợp .mp4, ngược lại AAC
 * - Preview 1 frame chạy đồng bộ ngoài queue (spawnManaged + timeout 20s)
 */

const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.bmp', '.tif', '.tiff'])

function isImageFile(p: string): boolean {
  return IMAGE_EXTS.has(path.extname(p).toLowerCase())
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v))
}

/** '#00ff00' | '00FF00' → 'RRGGBB' (throw nếu sai định dạng) */
function keyHex(color: string): string {
  const m = /^#?([0-9a-fA-F]{6})$/.exec((color || '').trim())
  if (!m) throw new Error('Màu key không hợp lệ — cần dạng #RRGGBB (vd #00FF00)')
  return m[1].toUpperCase()
}

/** Biểu thức X:Y cho filter overlay theo preset vị trí (main_w/overlay_w như logo) */
function overlayXY(p: GreenScreenParams): string {
  switch (p.position) {
    case 'top-left':
      return '0:0'
    case 'top-right':
      return 'main_w-overlay_w:0'
    case 'bottom-left':
      return '0:main_h-overlay_h'
    case 'bottom-right':
      return 'main_w-overlay_w:main_h-overlay_h'
    case 'custom':
      return `${Math.round(p.customX ?? 0)}:${Math.round(p.customY ?? 0)}`
    case 'center':
    default:
      return '(main_w-overlay_w)/2:(main_h-overlay_h)/2'
  }
}

/**
 * [1:v]scale=<W*pct/100>:-2[sc];[sc]chromakey=0xRRGGBB:<sim>:<blend>[ck];[0:v][ck]overlay=<X>:<Y>[outv]
 * Overlay là video: thêm eof_action=pass để lớp phủ biến mất khi hết (thay vì đứng hình frame cuối).
 */
function buildFilter(p: GreenScreenParams, bgWidth: number, ovIsImage: boolean): string {
  const pct = clamp(Number.isFinite(p.sizePct) ? p.sizePct : 100, 1, 400)
  // chiều rộng chẵn (yêu cầu của yuv420p), tối thiểu 2
  const w = Math.max(2, 2 * Math.round((bgWidth * pct) / 200))
  const sim = clamp(Number.isFinite(p.similarity) ? p.similarity : 0.3, 0.01, 1).toFixed(2)
  const blend = clamp(Number.isFinite(p.blend) ? p.blend : 0.1, 0, 1).toFixed(2)
  const eof = ovIsImage ? '' : ':eof_action=pass'
  return (
    `[1:v]scale=${w}:-2[sc];` +
    `[sc]chromakey=0x${keyHex(p.keyColor)}:${sim}:${blend}[ck];` +
    `[0:v][ck]overlay=${overlayXY(p)}${eof}[outv]`
  )
}

export default function register(ctx: ModuleContext): void {
  // ---- Render đầy đủ (qua TaskQueue) ----
  ctx.handle('mod:green-screen:start', async (p: GreenScreenStartPayload) => {
    const bgInfo = await ctx.probe(p.background)
    if (!bgInfo.video) throw new Error('Video nền không có luồng hình')
    const ovIsImage = isImageFile(p.overlay)
    const filter = buildFilter(p, bgInfo.video.width, ovIsImage)
    const enc = await ctx.pickEncoder('h264')
    const output = ctx.deriveOutput(p.background, '_greenscreen', p.outputDir, '.mp4')
    // Audio nền: copy chỉ khi codec hợp lệ với .mp4, ngược lại re-encode AAC
    const audioCopyOk =
      !bgInfo.audio || MP4_SAFE_AUDIO.has((bgInfo.audio.codec || '').toLowerCase())
    const args = [
      '-i', p.background,
      ...(ovIsImage ? ['-loop', '1'] : []),
      '-i', p.overlay,
      '-filter_complex', filter,
      '-map', '[outv]',
      '-map', '0:a?',
      ...(audioCopyOk ? ['-c:a', 'copy'] : ['-c:a', 'aac', '-b:a', '192k']),
      '-c:v', enc,
      ...encoderQualityArgs(enc),
      ...(ovIsImage ? ['-shortest'] : []),
      output
    ]
    return ctx.enqueueFfmpeg({
      type: 'green-screen',
      title: `Phông xanh: ${path.basename(p.background)}`,
      args,
      durationSec: bgInfo.durationSec,
      outputPath: output,
      meta: { mode: 're-encode' }
    })
  })

  // ---- Preview 1 frame (đồng bộ, KHÔNG qua queue) ----
  ctx.handle('mod:green-screen:preview', async (p: GreenScreenPreviewPayload) => {
    const bin = ctx.resolveBin('ffmpeg')
    if (!bin) throw new Error('Không tìm thấy FFmpeg — hãy tải binaries trong mục "Kiểm tra cập nhật"')
    const bgInfo = await ctx.probe(p.background)
    if (!bgInfo.video) throw new Error('Video nền không có luồng hình')
    const ovIsImage = isImageFile(p.overlay)
    const filter = buildFilter(p, bgInfo.video.width, ovIsImage)
    const maxAt = Math.max(0, (bgInfo.durationSec || 0) - 0.05)
    const atSec = clamp(Number.isFinite(p.atSec) ? p.atSec : 0, 0, maxAt)
    const tmpPng = path.join(
      os.tmpdir(),
      `vt-gs-preview-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.png`
    )
    const args = [
      '-hide_banner', '-nostdin',
      '-ss', String(atSec),
      '-i', p.background,
      ...(ovIsImage ? ['-loop', '1'] : ['-ss', String(atSec)]),
      '-i', p.overlay,
      '-filter_complex', `${filter};[outv]scale=w='min(960,iw)':h=-2[preview]`,
      '-map', '[preview]',
      '-frames:v', '1',
      '-f', 'image2',
      '-update', '1',
      '-y', tmpPng
    ]
    try {
      await new Promise<void>((resolve, reject) => {
        let lastLine = ''
        const { child } = ctx.pm.spawnManaged(bin, args, {
          onLine: (line) => {
            if (line.trim()) lastLine = line.trim()
          }
        })
        const timer = setTimeout(() => {
          ctx.pm.killTree(child.pid)
          reject(new Error('Preview quá 20 giây — đã huỷ'))
        }, 20_000)
        child.on('error', (e) => {
          clearTimeout(timer)
          reject(e)
        })
        child.on('close', (code) => {
          clearTimeout(timer)
          if (code === 0) resolve()
          else reject(new Error(`FFmpeg preview thoát mã ${code}: ${lastLine}`))
        })
      })
      if (!fs.existsSync(tmpPng)) throw new Error('Không tạo được frame preview')
      const b64 = fs.readFileSync(tmpPng).toString('base64')
      return `data:image/png;base64,${b64}`
    } finally {
      try {
        fs.unlinkSync(tmpPng)
      } catch {
        /* file có thể chưa được tạo */
      }
    }
  })
}
