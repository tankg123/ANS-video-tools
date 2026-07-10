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
    let count: number | undefined
    let target: number | undefined
    let durationSec: number

    if (p.mode === 'duration') {
      const T = p.targetSec ?? 0
      if (!Number.isFinite(T) || !(T > 0)) throw new Error('Tổng thời lượng mục tiêu phải lớn hơn 0')
      target = T
      durationSec = T
    } else if (p.mode === 'count') {
      const C = Math.floor(p.count ?? 0)
      if (!Number.isFinite(C) || !(C >= 1)) throw new Error('Số lần lặp phải từ 1 trở lên')
      count = C
      durationSec = d * C
    } else {
      throw new Error('Chế độ lặp không hợp lệ')
    }

    const output = ctx.deriveOutput(p.input, '_loop', outputDir)
    // -stream_loop N = phát thêm N lần (tổng N+1 lần); duration mode lặp dư rồi cắt bằng -t.
    const args = target !== undefined
      ? ['-stream_loop', String(Math.max(0, Math.ceil(target / d))), '-i', p.input, '-c', 'copy', '-t', String(target), output]
      : ['-stream_loop', String((count as number) - 1), '-i', p.input, '-c', 'copy', output]

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
