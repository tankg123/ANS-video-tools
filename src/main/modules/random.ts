import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { ModuleContext } from '../module-context'
import type { FfmpegTaskOptions } from '../ffmpeg'
import { encoderQualityArgs } from '../util'
import type { RandomStartPayload, RandomThumbPayload } from '@shared/modules/random'

/** làm tròn xuống số chẵn (yêu cầu của h264/yuv420p) */
function even(n: number): number {
  return Math.max(2, Math.floor(n / 2) * 2)
}

interface Probed {
  path: string
  durationSec: number
  vcodec: string
  acodec: string
  hasAudio: boolean
  width: number
  height: number
  fps: number
}

async function probeAll(ctx: ModuleContext, inputs: string[]): Promise<Probed[]> {
  return Promise.all(
    inputs.map(async (p): Promise<Probed> => {
      const mi = await ctx.probe(p)
      if (!mi.video) throw new Error(`File không có luồng video: ${path.basename(p)}`)
      return {
        path: p,
        durationSec: mi.durationSec || 0,
        vcodec: mi.video.codec,
        acodec: mi.audio?.codec ?? '',
        hasAudio: !!mi.audio,
        width: mi.video.width,
        height: mi.video.height,
        fps: mi.video.fps || 0
      }
    })
  )
}

/** Cùng video codec + audio codec + width/height + |fps chênh| < 0.5 → ghép copy được (tức thì). */
function isCompatible(infos: Probed[]): boolean {
  const first = infos[0]
  for (const i of infos.slice(1)) {
    if (i.vcodec !== first.vcodec) return false
    if (i.acodec !== first.acodec) return false
    if (i.width !== first.width || i.height !== first.height) return false
    if (Math.abs(i.fps - first.fps) >= 0.5) return false
  }
  return true
}

/**
 * Dựng spec 1 task ghép (concat) cho 1 danh sách file đã chốt thứ tự — CHỈ probe + kiểm tra
 * + build args, KHÔNG đưa vào hàng đợi (để handler validate tất cả rồi mới enqueue: all-or-nothing).
 * Cùng chuẩn (và không ép re-encode) → concat demuxer '-c copy' (tức thì);
 * khác chuẩn / ép re-encode → chuẩn hoá scale+pad+fps + filter concat.
 * variantIdx > 0 để đặt tên & tiêu đề khi tạo nhiều bản cùng lúc.
 */
async function buildSpec(
  ctx: ModuleContext,
  inputs: string[],
  forceReencode: boolean,
  outputDir: string | undefined,
  variantIdx: number
): Promise<FfmpegTaskOptions> {
  if (!Array.isArray(inputs) || inputs.length < 2) {
    throw new Error('Mỗi bản ghép cần ít nhất 2 video')
  }
  const infos = await probeAll(ctx, inputs)
  const totalDur = infos.reduce((s, i) => s + i.durationSec, 0)
  const first = inputs[0]
  const suffix = variantIdx > 0 ? `_random_${variantIdx}` : '_random'
  const tag = variantIdx > 0 ? ` — bản ${variantIdx}` : ''

  // ---- Chế độ copy: concat demuxer, không re-encode ----
  if (!forceReencode && isCompatible(infos)) {
    const exts = new Set(inputs.map((f) => path.extname(f).toLowerCase()))
    const ext = exts.size === 1 && path.extname(first) ? path.extname(first) : '.mp4'
    const output = ctx.deriveOutput(first, suffix, outputDir, ext)
    const lines = inputs.map((f) => `file '${ctx.concatEscape(f)}'`).join('\n') + '\n'
    const listFile = ctx.writeTempFile(
      first,
      `random_${Date.now()}_${variantIdx}_${Math.random().toString(36).slice(2, 7)}.txt`,
      lines
    )
    return {
      type: 'random',
      title: `Ghép ngẫu nhiên ${inputs.length} video (copy)${tag}`,
      args: ['-f', 'concat', '-safe', '0', '-i', listFile, '-c', 'copy', output],
      durationSec: totalDur,
      outputPath: output,
      meta: { mode: 'copy', count: inputs.length, variant: variantIdx }
    }
  }

  // ---- Chế độ re-encode: chuẩn hoá scale/pad/fps + filter concat ----
  const noAudio = infos.filter((i) => !i.hasAudio)
  if (noAudio.length) {
    throw new Error(
      `File thiếu luồng audio, không thể chuẩn hoá để ghép: ${noAudio
        .map((i) => path.basename(i.path))
        .join(', ')}`
    )
  }

  let biggest = infos[0]
  for (const i of infos) if (i.width * i.height > biggest.width * biggest.height) biggest = i
  const W = even(biggest.width)
  const H = even(biggest.height)
  const F = Math.round(Math.max(...infos.map((i) => i.fps || 30)) * 1000) / 1000 || 30
  const n = inputs.length

  const parts: string[] = []
  const pads: string[] = []
  for (let i = 0; i < n; i++) {
    parts.push(
      `[${i}:v]scale=${W}:${H}:force_original_aspect_ratio=decrease,` +
        `pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=${F},format=yuv420p[v${i}]`
    )
    parts.push(`[${i}:a]aresample=44100,aformat=sample_fmts=fltp:channel_layouts=stereo[a${i}]`)
    pads.push(`[v${i}][a${i}]`)
  }
  parts.push(`${pads.join('')}concat=n=${n}:v=1:a=1[vout][aout]`)

  const enc = await ctx.pickEncoder('h264')
  const output = ctx.deriveOutput(first, suffix, outputDir, '.mp4')
  const args = [
    ...inputs.flatMap((f) => ['-i', f]),
    '-filter_complex', parts.join(';'),
    '-map', '[vout]',
    '-map', '[aout]',
    '-c:v', enc,
    ...encoderQualityArgs(enc, 18),
    '-c:a', 'aac',
    '-b:a', '192k',
    output
  ]
  return {
    type: 'random',
    title: `Ghép ngẫu nhiên ${n} video (chuẩn hoá ${W}×${H}@${F})${tag}`,
    args,
    durationSec: totalDur,
    outputPath: output,
    meta: { mode: 're-encode', count: n, variant: variantIdx, targetW: W, targetH: H, targetFps: F }
  }
}

/**
 * Module Ghép Video Ngẫu Nhiên:
 * - 'start' : nhận danh sách bản ghép đã chốt (jobs) → enqueue mỗi bản 1 task concat.
 * - 'thumb' : trích 1 frame làm ảnh xem trước (JPEG data URI) cho tile.
 */
export default function register(ctx: ModuleContext): void {
  ctx.handle('mod:random:start', async (p: RandomStartPayload) => {
    const jobs = Array.isArray(p.jobs) ? p.jobs : []
    if (!jobs.length) throw new Error('Chưa có bản ghép nào — hãy "Trộn ngẫu nhiên" trước')
    // Hai pha: probe + validate + dựng spec cho TẤT CẢ bản trước; nếu một bản lỗi (vd thiếu
    // audio khi phải re-encode) thì reject trước khi enqueue bất kỳ task nào (all-or-nothing).
    const specs = await Promise.all(
      jobs.map((inputs, i) =>
        buildSpec(ctx, inputs, !!p.forceReencode, p.outputDir, jobs.length > 1 ? i + 1 : 0)
      )
    )
    return specs.map((s) => ctx.enqueueFfmpeg(s))
  })

  // ---- Thumbnail 1 frame (đồng bộ, KHÔNG qua queue) ----
  ctx.handle('mod:random:thumb', async (p: RandomThumbPayload) => {
    const bin = ctx.resolveBin('ffmpeg')
    if (!bin) throw new Error('Không tìm thấy FFmpeg — hãy tải binaries trong mục "Kiểm tra cập nhật"')
    let atSec = p.atSec
    if (!Number.isFinite(atSec as number)) {
      try {
        const mi = await ctx.probe(p.path)
        atSec = Math.min(3, Math.max(0, (mi.durationSec || 0) * 0.1))
      } catch {
        atSec = 0
      }
    }
    const tmp = path.join(
      os.tmpdir(),
      `vt-rnd-thumb-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`
    )
    const args = [
      '-hide_banner', '-nostdin',
      '-ss', String(Math.max(0, atSec as number)),
      '-i', p.path,
      '-frames:v', '1',
      '-vf', 'scale=320:-2',
      '-q:v', '5',
      '-f', 'image2',
      '-update', '1',
      '-y', tmp
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
          reject(new Error('Thumbnail quá 15 giây — đã huỷ'))
        }, 15_000)
        child.on('error', (e) => {
          clearTimeout(timer)
          reject(e)
        })
        child.on('close', (code) => {
          clearTimeout(timer)
          if (code === 0) resolve()
          else reject(new Error(`FFmpeg thumbnail thoát mã ${code}: ${lastLine}`))
        })
      })
      if (!fs.existsSync(tmp)) throw new Error('Không tạo được thumbnail')
      const b64 = fs.readFileSync(tmp).toString('base64')
      return `data:image/jpeg;base64,${b64}`
    } finally {
      try {
        fs.unlinkSync(tmp)
      } catch {
        /* file có thể chưa được tạo */
      }
    }
  })
}
