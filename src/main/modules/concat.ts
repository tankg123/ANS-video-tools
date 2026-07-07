import path from 'node:path'
import type { ModuleContext } from '../module-context'
import { encoderQualityArgs } from '../util'
import type {
  ConcatAnalyzePayload,
  ConcatAnalyzeResult,
  ConcatFileInfo,
  ConcatStartPayload
} from '@shared/modules/concat'

/** làm tròn xuống số chẵn (yêu cầu của h264/yuv420p) */
function even(n: number): number {
  return Math.max(2, Math.floor(n / 2) * 2)
}

/**
 * Probe toàn bộ danh sách và quyết định chế độ ghép.
 * Compatible = cùng video codec + audio codec + width/height + |fps chênh| < 0.5.
 */
async function analyze(ctx: ModuleContext, inputs: string[]): Promise<ConcatAnalyzeResult> {
  if (!Array.isArray(inputs) || inputs.length < 2) {
    throw new Error('Cần ít nhất 2 video để ghép nối')
  }
  const infos: ConcatFileInfo[] = await Promise.all(
    inputs.map(async (p): Promise<ConcatFileInfo> => {
      const mi = await ctx.probe(p)
      if (!mi.video) throw new Error(`File không có luồng video: ${path.basename(p)}`)
      return {
        path: p,
        durationSec: mi.durationSec || 0,
        sizeBytes: mi.sizeBytes,
        vcodec: mi.video.codec,
        acodec: mi.audio?.codec ?? '',
        hasAudio: !!mi.audio,
        width: mi.video.width,
        height: mi.video.height,
        fps: mi.video.fps || 0
      }
    })
  )

  const first = infos[0]
  const reasons = new Set<string>()
  for (const i of infos.slice(1)) {
    if (i.vcodec !== first.vcodec) {
      reasons.add(`Codec video khác nhau (${first.vcodec} ≠ ${i.vcodec})`)
    }
    if (i.acodec !== first.acodec) {
      reasons.add(`Codec audio khác nhau (${first.acodec || 'không có'} ≠ ${i.acodec || 'không có'})`)
    }
    if (i.width !== first.width || i.height !== first.height) {
      reasons.add(`Độ phân giải khác nhau (${first.width}×${first.height} ≠ ${i.width}×${i.height})`)
    }
    if (Math.abs(i.fps - first.fps) >= 0.5) {
      reasons.add(`FPS khác nhau (${first.fps} ≠ ${i.fps})`)
    }
  }

  // Chuẩn đầu ra khi phải re-encode: độ phân giải của file lớn nhất, fps cao nhất
  let biggest = infos[0]
  for (const i of infos) {
    if (i.width * i.height > biggest.width * biggest.height) biggest = i
  }
  const targetFps = Math.round(Math.max(...infos.map((i) => i.fps || 30)) * 1000) / 1000 || 30

  return {
    compatible: reasons.size === 0,
    infos,
    targetW: even(biggest.width),
    targetH: even(biggest.height),
    targetFps,
    totalDur: infos.reduce((s, i) => s + i.durationSec, 0),
    reasons: [...reasons]
  }
}

/**
 * Module Ghép nối Video (spec 4.9):
 * - Cùng codec/độ phân giải/fps → concat demuxer `-c copy` (tức thì)
 * - Khác chuẩn → chuẩn hoá (scale + pad + fps + re-encode) rồi ghép bằng filter concat.
 *   UI phải gọi 'analyze' trước và hiện dialog xác nhận khi !compatible.
 */
export default function register(ctx: ModuleContext): void {
  ctx.handle('mod:concat:analyze', async (p: ConcatAnalyzePayload) => analyze(ctx, p.inputs))

  ctx.handle('mod:concat:start', async (p: ConcatStartPayload) => {
    const a = await analyze(ctx, p.inputs)
    const firstInput = p.inputs[0]

    // ---- Chế độ copy: concat demuxer, không re-encode ----
    if (p.mode === 'copy') {
      if (!a.compatible) {
        throw new Error(
          `Các video không cùng chuẩn (${a.reasons.join('; ')}) — cần chuẩn hoá + re-encode. Hãy Phân tích lại.`
        )
      }
      // giữ đuôi file gốc nếu tất cả cùng đuôi (an toàn container khi copy), khác nhau → .mp4
      const exts = new Set(p.inputs.map((f) => path.extname(f).toLowerCase()))
      const ext = exts.size === 1 && path.extname(firstInput) ? path.extname(firstInput) : '.mp4'
      const output = ctx.deriveOutput(firstInput, '_merged', p.outputDir, ext)
      const lines = p.inputs.map((f) => `file '${ctx.concatEscape(f)}'`).join('\n') + '\n'
      const listFile = ctx.writeTempFile(firstInput, `concat_${Date.now()}.txt`, lines)
      return ctx.enqueueFfmpeg({
        type: 'concat',
        title: `Ghép ${p.inputs.length} video (copy)`,
        args: ['-f', 'concat', '-safe', '0', '-i', listFile, '-c', 'copy', output],
        durationSec: a.totalDur,
        outputPath: output,
        meta: { mode: 'copy', count: p.inputs.length }
      })
    }

    // ---- Chế độ re-encode: chuẩn hoá scale/pad/fps + filter concat ----
    const noAudio = a.infos.filter((i) => !i.hasAudio)
    if (noAudio.length) {
      throw new Error(
        `File thiếu luồng audio, không thể chuẩn hoá để ghép: ${noAudio
          .map((i) => path.basename(i.path))
          .join(', ')}`
      )
    }

    const { targetW: W, targetH: H, targetFps: F } = a
    const n = p.inputs.length
    const parts: string[] = []
    const pads: string[] = []
    for (let i = 0; i < n; i++) {
      parts.push(
        `[${i}:v]scale=${W}:${H}:force_original_aspect_ratio=decrease,` +
          `pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=${F},format=yuv420p[v${i}]`
      )
      // aformat để đồng nhất sample format + channel layout (bắt buộc với filter concat)
      parts.push(`[${i}:a]aresample=44100,aformat=sample_fmts=fltp:channel_layouts=stereo[a${i}]`)
      pads.push(`[v${i}][a${i}]`)
    }
    parts.push(`${pads.join('')}concat=n=${n}:v=1:a=1[vout][aout]`)

    const enc = await ctx.pickEncoder('h264')
    const output = ctx.deriveOutput(firstInput, '_merged', p.outputDir, '.mp4')
    const args = [
      ...p.inputs.flatMap((f) => ['-i', f]),
      '-filter_complex', parts.join(';'),
      '-map', '[vout]',
      '-map', '[aout]',
      '-c:v', enc,
      ...encoderQualityArgs(enc, 18),
      '-c:a', 'aac',
      '-b:a', '192k',
      output
    ]
    return ctx.enqueueFfmpeg({
      type: 'concat',
      title: `Ghép ${n} video (chuẩn hoá ${W}×${H}@${F})`,
      args,
      durationSec: a.totalDur,
      outputPath: output,
      meta: { mode: 're-encode', count: n, targetW: W, targetH: H, targetFps: F }
    })
  })
}
