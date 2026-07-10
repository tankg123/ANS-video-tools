import fs from 'node:fs'
import path from 'node:path'
import type { ModuleContext } from '../module-context'
import type { LoopStartPayload } from '@shared/modules/loop'

/**
 * Module Lặp lại Video (spec 4.8):
 * - Lặp đến TỔNG THỜI LƯỢNG MỤC TIÊU hoặc theo SỐ LẦN LẶP.
 * - Luôn dùng '-stream_loop N -c copy' (không re-encode) — gần như tức thì.
 * - Lưu ý: -stream_loop phải đứng TRƯỚC -i.
 */
export default function register(ctx: ModuleContext): void {
  ctx.handle('mod:loop:start', async (p: LoopStartPayload) => {
    if (!p?.input) throw new Error('Chưa chọn video nguồn')
    const info = await ctx.probe(p.input)
    const d = info.durationSec
    if (!(d > 0)) throw new Error('Không đọc được thời lượng video nguồn')

    const outputDir = p.outputDir?.trim() || undefined
    if (outputDir) {
      try {
        if (!fs.statSync(outputDir).isDirectory()) throw new Error()
      } catch {
        throw new Error('Thư mục xuất không tồn tại hoặc không truy cập được')
      }
    }

    const output = ctx.deriveOutput(p.input, '_loop', outputDir)
    let args: string[]
    let durationSec: number

    if (p.mode === 'duration') {
      const T = p.targetSec ?? 0
      if (!(T > 0)) throw new Error('Tổng thời lượng mục tiêu phải lớn hơn 0')
      // Lặp dư 1 vòng rồi cắt chính xác bằng -t T
      const loops = Math.max(0, Math.ceil(T / d))
      args = ['-stream_loop', String(loops), '-i', p.input, '-c', 'copy', '-t', String(T), output]
      durationSec = T
    } else {
      const C = Math.floor(p.count ?? 0)
      if (!(C >= 1)) throw new Error('Số lần lặp phải từ 1 trở lên')
      // -stream_loop N = phát thêm N lần (tổng N+1 lần)
      args = ['-stream_loop', String(C - 1), '-i', p.input, '-c', 'copy', output]
      durationSec = d * C
    }

    return ctx.enqueueFfmpeg({
      type: 'loop',
      title: `Lặp: ${path.basename(p.input)}`,
      args,
      durationSec,
      outputPath: output,
      meta: { mode: 'copy' }
    })
  })
}
