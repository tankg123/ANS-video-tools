import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { ModuleContext } from '../module-context'
import type { FfmpegTaskOptions } from '../ffmpeg'
import { encoderQualityArgs, releaseOutput } from '../util'
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
  const exts = new Set(inputs.map((f) => path.extname(f).toLowerCase()))
  if (!forceReencode && exts.size === 1 && isCompatible(infos)) {
    const ext = path.extname(first) || '.mkv'
    const output = ctx.deriveOutput(first, suffix, outputDir, ext)
    const lines = inputs.map((f) => `file '${ctx.concatEscape(f)}'`).join('\n') + '\n'
    let listFile: string
    try {
      listFile = ctx.writeTempFile(
        first,
        `random_${Date.now()}_${variantIdx}_${Math.random().toString(36).slice(2, 7)}.txt`,
        lines
      )
    } catch (error) {
      releaseOutput(output)
      throw error
    }
    return {
      type: 'random',
      title: `Ghép ngẫu nhiên ${inputs.length} video (copy)${tag}`,
      args: ['-f', 'concat', '-safe', '0', '-i', listFile, '-c', 'copy', output],
      durationSec: totalDur,
      outputPath: output,
      cleanupPaths: [listFile],
      meta: { mode: 'copy', count: inputs.length, variant: variantIdx }
    }
  }

  // ---- Chế độ re-encode: chuẩn hoá scale/pad/fps + filter concat ----
  // Video thiếu audio vẫn được ghép: nếu bản có video khác mang audio, chèn im lặng đúng
  // thời lượng cho đoạn bị thiếu; nếu toàn bộ đều không có audio thì xuất video-only.
  const hasAnyAudio = infos.some((i) => i.hasAudio)
  let biggest = infos[0]
  for (const i of infos) if (i.width * i.height > biggest.width * biggest.height) biggest = i
  const W = even(biggest.width)
  const H = even(biggest.height)
  const F = Math.round(Math.max(...infos.map((i) => i.fps || 30)) * 1000) / 1000 || 30
  const n = inputs.length

  const parts: string[] = []
  const pads: string[] = []
  for (let i = 0; i < n; i++) {
    const info = infos[i]
    parts.push(
      `[${i}:v]setpts=PTS-STARTPTS,scale=${W}:${H}:force_original_aspect_ratio=decrease,` +
        `pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=${F},format=yuv420p[v${i}]`
    )
    if (hasAnyAudio) {
      const duration = Number.isFinite(info.durationSec) && info.durationSec > 0
        ? Number(info.durationSec.toFixed(6))
        : 0.001
      if (info.hasAudio) {
        parts.push(
          `[${i}:a]aresample=44100:async=1:first_pts=0,` +
            `aformat=sample_fmts=fltp:channel_layouts=stereo,apad,` +
            `atrim=duration=${duration},asetpts=PTS-STARTPTS[a${i}]`
        )
      } else {
        parts.push(
          `anullsrc=channel_layout=stereo:sample_rate=44100,` +
            `atrim=duration=${duration},asetpts=PTS-STARTPTS[a${i}]`
        )
      }
      pads.push(`[v${i}][a${i}]`)
    } else {
      pads.push(`[v${i}]`)
    }
  }
  parts.push(
    `${pads.join('')}concat=n=${n}:v=1:a=${hasAnyAudio ? 1 : 0}[vout]${hasAnyAudio ? '[aout]' : ''}`
  )

  const enc = await ctx.pickEncoder('h264')
  const output = ctx.deriveOutput(first, suffix, outputDir, '.mp4')
  const args = [
    ...inputs.flatMap((f) => ['-i', f]),
    '-filter_complex', parts.join(';'),
    '-map', '[vout]',
    ...(hasAnyAudio ? ['-map', '[aout]'] : []),
    '-c:v', enc,
    ...encoderQualityArgs(enc, 18),
    ...(hasAnyAudio ? ['-c:a', 'aac', '-b:a', '192k'] : ['-an']),
    output
  ]
  return {
    type: 'random',
    title: `Ghép ngẫu nhiên ${n} video (chuẩn hoá ${W}×${H}@${F}${hasAnyAudio ? '' : ', không audio'})${tag}`,
    args,
    durationSec: totalDur,
    outputPath: output,
    meta: {
      mode: 're-encode',
      count: n,
      variant: variantIdx,
      targetW: W,
      targetH: H,
      targetFps: F,
      audio: hasAnyAudio ? (infos.every((i) => i.hasAudio) ? 'source' : 'silence-filled') : 'none'
    }
  }
}

/**
 * Module Ghép Video Ngẫu Nhiên:
 * - 'start' : nhận danh sách bản ghép đã chốt (jobs) → enqueue mỗi bản 1 task concat.
 * - 'thumb' : trích 1 frame làm ảnh xem trước (JPEG data URI) cho tile.
 */
export default function register(ctx: ModuleContext): void {
  const startDrafts = async (p: RandomStartPayload): Promise<string[]> => {
    const jobs = Array.isArray(p?.jobs) ? p.jobs : []
    if (!jobs.length) throw new Error('Chưa có bản ghép nào — hãy "Trộn ngẫu nhiên" trước')
    const outputDir = p.outputDir?.trim() || undefined
    if (outputDir) {
      try {
        if (!fs.statSync(outputDir).isDirectory()) throw new Error()
      } catch {
        throw new Error('Thư mục xuất không tồn tại hoặc không truy cập được')
      }
    }
    // Hai pha: probe + validate + dựng spec cho TẤT CẢ bản trước; nếu một bản lỗi thì reject
    // trước khi enqueue bất kỳ task nào (all-or-nothing).
    const built = await Promise.allSettled(
      jobs.map((inputs, i) =>
        buildSpec(ctx, inputs, !!p.forceReencode, outputDir, jobs.length > 1 ? i + 1 : 0)
      )
    )
    const failed = built.find((result) => result.status === 'rejected')
    if (failed) {
      for (const result of built) {
        if (result.status !== 'fulfilled') continue
        releaseOutput(result.value.outputPath)
        for (const filePath of result.value.cleanupPaths ?? []) {
          try { fs.rmSync(filePath, { force: true }) } catch { /* ignore */ }
        }
      }
      throw failed.reason instanceof Error ? failed.reason : new Error(String(failed.reason))
    }
    const specs = built.map((result) => (result as PromiseFulfilledResult<FfmpegTaskOptions>).value)
    const draftId = typeof p.draftId === 'string' ? p.draftId.trim() : ''
    if (draftId) {
      for (const spec of specs) spec.meta = { ...spec.meta, draftId }
    }
    return specs.map((s) => ctx.enqueueFfmpeg(s))
  }

  // Giữ Promise đã/đang enqueue theo draft ID để hai lần bấm nhanh hoặc đổi tab trong lúc
  // chuẩn bị task không thể tạo hai output giống nhau. Lỗi được xoá khỏi map để người dùng retry.
  const draftStarts = new Map<string, Promise<string[]>>()
  ctx.handle('mod:random:start', (p: RandomStartPayload) => {
    const draftId = typeof p?.draftId === 'string' ? p.draftId.trim() : ''
    if (!draftId || !Array.isArray(p?.jobs) || p.jobs.length !== 1) return startDrafts(p)
    const existing = draftStarts.get(draftId)
    if (existing) return existing
    const pending = startDrafts(p).catch((error) => {
      draftStarts.delete(draftId)
      throw error
    })
    draftStarts.set(draftId, pending)
    return pending
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
