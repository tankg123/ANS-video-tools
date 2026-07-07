import path from 'node:path'
import type { ModuleContext } from '../module-context'
import type { TrimStartPayload } from '@shared/modules/trim'
import { encoderQualityArgs } from '../util'

/**
 * Module Cắt ngắn Video (spec 4.6):
 * - Ưu tiên `-ss ... -t ... -c copy` (không re-encode, gần như tức thì)
 * - Tuỳ chọn re-encode chính xác từng frame (dùng encoder phần cứng nếu có)
 */
export default function register(ctx: ModuleContext): void {
  ctx.handle('mod:trim:start', async (p: TrimStartPayload) => {
    const info = await ctx.probe(p.input)
    const start = Math.max(0, p.start)
    const end = Math.min(p.end, info.durationSec || p.end)
    const dur = end - start
    if (!(dur > 0)) throw new Error('Điểm kết thúc phải lớn hơn điểm bắt đầu')

    // precise re-encode h264+aac → luôn xuất .mp4 (giữ đuôi gốc .webm/.mpg sẽ fail write header)
    const output = p.precise
      ? ctx.deriveOutput(p.input, '_cut', p.outputDir, '.mp4')
      : ctx.deriveOutput(p.input, '_cut', p.outputDir)
    let args: string[]
    if (p.precise) {
      const enc = await ctx.pickEncoder('h264')
      args = [
        '-ss', start.toFixed(3),
        '-i', p.input,
        '-t', dur.toFixed(3),
        '-c:v', enc,
        ...encoderQualityArgs(enc),
        '-c:a', 'aac',
        '-b:a', '192k',
        output
      ]
    } else {
      args = [
        '-ss', start.toFixed(3),
        '-i', p.input,
        '-t', dur.toFixed(3),
        '-c', 'copy',
        '-avoid_negative_ts', 'make_zero',
        output
      ]
    }
    return ctx.enqueueFfmpeg({
      type: 'trim',
      title: `Cắt: ${path.basename(p.input)}`,
      args,
      durationSec: dur,
      outputPath: output,
      meta: { mode: p.precise ? 're-encode' : 'copy' }
    })
  })
}
