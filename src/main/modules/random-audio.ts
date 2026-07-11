import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { ModuleContext } from '../module-context'
import type { FfmpegTaskOptions } from '../ffmpeg'
import { releaseOutput } from '../util'
import type {
  RandomAudioFormat,
  RandomAudioScanPayload,
  RandomAudioStartPayload,
  RandomAudioWavePayload
} from '@shared/modules/random-audio'

/** Đuôi file âm thanh nhận diện được (kho + quét thư mục). */
const AUDIO_EXTS = new Set([
  '.mp3', '.m4a', '.aac', '.wav', '.flac', '.ogg', '.oga', '.opus', '.wma', '.aiff', '.aif', '.ac3', '.mka'
])

function isAudioFile(p: string): boolean {
  return AUDIO_EXTS.has(path.extname(p).toLowerCase())
}

/** Quét đệ quy 1 thư mục lấy danh sách file âm thanh (sắp theo tên). */
function scanAudioDir(dir: string, maxDepth = 3): string[] {
  const out: string[] = []
  const walk = (d: string, depth: number): void => {
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(d, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      const p = path.join(d, e.name)
      if (e.isDirectory()) {
        if (depth < maxDepth) walk(p, depth + 1)
      } else if (isAudioFile(p)) {
        out.push(p)
      }
    }
  }
  walk(dir, 0)
  return out.sort((a, b) => a.localeCompare(b))
}

interface Probed {
  path: string
  durationSec: number
  acodec: string
  sampleRate: number
  channels: number
  hasAudio: boolean
}

async function probeAll(ctx: ModuleContext, inputs: string[]): Promise<Probed[]> {
  return Promise.all(
    inputs.map(async (p): Promise<Probed> => {
      const mi = await ctx.probe(p)
      if (!mi.audio) throw new Error(`File không có luồng âm thanh: ${path.basename(p)}`)
      return {
        path: p,
        durationSec: mi.durationSec || 0,
        acodec: mi.audio.codec,
        sampleRate: mi.audio.sampleRate ?? 0,
        channels: mi.audio.channels ?? 0,
        hasAudio: true
      }
    })
  )
}

/** Cùng audio codec + sample rate + số kênh → luồng âm thanh ghép copy được (tức thì). */
function isCompatible(infos: Probed[]): boolean {
  const first = infos[0]
  for (const i of infos.slice(1)) {
    if (i.acodec !== first.acodec) return false
    if (i.sampleRate !== first.sampleRate) return false
    if (i.channels !== first.channels) return false
  }
  return true
}

/**
 * Dựng spec 1 task ghép (concat) cho 1 danh sách file đã chốt thứ tự — CHỈ probe + kiểm tra
 * + build args, KHÔNG đưa vào hàng đợi (để handler validate tất cả rồi mới enqueue: all-or-nothing).
 * Cùng chuẩn (và không ép re-encode) → concat demuxer '-c copy' (tức thì);
 * khác chuẩn / khác định dạng đích / ép re-encode → chuẩn hoá rồi xuất MP3 hoặc WAV.
 * variantIdx > 0 để đặt tên & tiêu đề khi tạo nhiều bản cùng lúc.
 */
async function buildSpec(
  ctx: ModuleContext,
  inputs: string[],
  forceReencode: boolean,
  format: RandomAudioFormat,
  outputDir: string | undefined,
  variantIdx: number
): Promise<FfmpegTaskOptions> {
  if (!Array.isArray(inputs) || inputs.length < 2) {
    throw new Error('Mỗi bản ghép cần ít nhất 2 file âm thanh')
  }
  const infos = await probeAll(ctx, inputs)
  const totalDur = infos.reduce((s, i) => s + i.durationSec, 0)
  const first = inputs[0]
  const suffix = variantIdx > 0 ? `_random_${variantIdx}` : '_random'
  const tag = variantIdx > 0 ? ` — bản ${variantIdx}` : ''

  // ---- Chế độ copy: concat demuxer, không re-encode ----
  // Chỉ copy khi TẤT CẢ file cùng đuôi/container: trộn container khác nhau (vd .aac ADTS + .m4a)
  // làm lỗi bitstream khi mux copy (đã kiểm chứng bằng ffmpeg). '-map 0:a' bỏ ảnh bìa (album art)
  // để không cố nhét luồng mjpeg vào container không nhận (m4a/aac) — cũng đã kiểm chứng.
  const exts = new Set(inputs.map((f) => path.extname(f).toLowerCase()))
  const sameExt = exts.size === 1 && !!path.extname(first)
  const targetExt = format === 'wav' ? '.wav' : '.mp3'
  const alreadyTargetFormat = sameExt && exts.has(targetExt)
  if (!forceReencode && alreadyTargetFormat && isCompatible(infos)) {
    const ext = path.extname(first)
    const output = ctx.deriveOutput(first, suffix, outputDir, ext)
    const lines = inputs.map((f) => `file '${ctx.concatEscape(f)}'`).join('\n') + '\n'
    let listFile: string
    try {
      listFile = ctx.writeTempFile(
        first,
        `rndaudio_${Date.now()}_${variantIdx}_${Math.random().toString(36).slice(2, 7)}.txt`,
        lines
      )
    } catch (error) {
      releaseOutput(output)
      throw error
    }
    return {
      type: 'random-audio',
      title: `Ghép âm thanh ngẫu nhiên ${inputs.length} file (copy)${tag}`,
      args: ['-f', 'concat', '-safe', '0', '-i', listFile, '-map', '0:a:0', '-c', 'copy', output],
      durationSec: totalDur,
      outputPath: output,
      cleanupPaths: [listFile],
      meta: { mode: 'copy', count: inputs.length, variant: variantIdx }
    }
  }

  // ---- Chế độ re-encode: chuẩn hoá aformat từng file + filter concat ----
  const n = inputs.length
  const parts: string[] = []
  const labels: string[] = []
  for (let i = 0; i < n; i++) {
    parts.push(
      `[${i}:a]asetpts=PTS-STARTPTS,aformat=sample_fmts=fltp:sample_rates=44100:channel_layouts=stereo[a${i}]`
    )
    labels.push(`[a${i}]`)
  }
  parts.push(`${labels.join('')}concat=n=${n}:v=0:a=1[aout]`)

  const useWav = format === 'wav'
  const ext = useWav ? '.wav' : '.mp3'
  const output = ctx.deriveOutput(first, suffix, outputDir, ext)
  const codecArgs = useWav
    ? ['-c:a', 'pcm_s16le']
    : ['-c:a', 'libmp3lame', '-q:a', '2']
  const args = [
    ...inputs.flatMap((f) => ['-i', f]),
    '-filter_complex', parts.join(';'),
    '-map', '[aout]',
    ...codecArgs,
    output
  ]
  return {
    type: 'random-audio',
    title: `Ghép âm thanh ngẫu nhiên ${n} file (${useWav ? 'WAV' : 'MP3'})${tag}`,
    args,
    durationSec: totalDur,
    outputPath: output,
    meta: { mode: 're-encode', count: n, variant: variantIdx, format }
  }
}

/**
 * Module Ghép Âm Thanh Ngẫu Nhiên:
 * - 'start'   : nhận danh sách bản ghép đã chốt (jobs) → enqueue mỗi bản 1 task concat.
 * - 'wave'    : sinh ảnh sóng âm (PNG data URI) làm xem trước cho tile.
 * - 'scanDir' : quét thư mục lấy danh sách file âm thanh (core:scanDir chỉ quét video).
 */
export default function register(ctx: ModuleContext): void {
  const startDrafts = async (p: RandomAudioStartPayload): Promise<string[]> => {
    const jobs = Array.isArray(p?.jobs) ? p.jobs : []
    if (!jobs.length) throw new Error('Chưa có bản ghép nào — hãy "Trộn ngẫu nhiên" trước')
    const format: RandomAudioFormat = p.format === 'wav' ? 'wav' : 'mp3'
    const outputDir = p.outputDir?.trim() || undefined
    if (outputDir) {
      try {
        if (!fs.statSync(outputDir).isDirectory()) throw new Error()
      } catch {
        throw new Error('Thư mục xuất không tồn tại hoặc không truy cập được')
      }
    }
    // Hai pha: probe + validate + dựng spec cho TẤT CẢ bản trước; nếu một bản lỗi (vd thiếu
    // audio) thì reject trước khi enqueue bất kỳ task nào (all-or-nothing).
    const built = await Promise.allSettled(
      jobs.map((inputs, i) =>
        buildSpec(ctx, inputs, !!p.forceReencode, format, outputDir, jobs.length > 1 ? i + 1 : 0)
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

  // Idempotency trong vòng đời ứng dụng: một draft chỉ được enqueue một lần, kể cả khi
  // renderer đổi module/remount trong lúc ffprobe đang chuẩn bị task. Draft lỗi vẫn được retry.
  const draftStarts = new Map<string, Promise<string[]>>()
  ctx.handle('mod:random-audio:start', (p: RandomAudioStartPayload) => {
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

  // ---- Quét thư mục lấy file âm thanh (đồng bộ) ----
  ctx.handle('mod:random-audio:scanDir', async (p: RandomAudioScanPayload) => {
    const dir = (p?.dir ?? '').trim()
    if (!dir) return []
    try {
      if (!fs.statSync(dir).isDirectory()) return []
    } catch {
      return []
    }
    return scanAudioDir(dir)
  })

  // ---- Ảnh sóng âm 1 frame (đồng bộ, KHÔNG qua queue) ----
  ctx.handle('mod:random-audio:wave', async (p: RandomAudioWavePayload) => {
    const bin = ctx.resolveBin('ffmpeg')
    if (!bin) throw new Error('Không tìm thấy FFmpeg — hãy tải binaries trong mục "Kiểm tra cập nhật"')
    const tmp = path.join(
      os.tmpdir(),
      `vt-rndaudio-wave-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.png`
    )
    const args = [
      '-hide_banner', '-nostdin',
      '-i', p.path,
      '-filter_complex', 'aformat=channel_layouts=mono,showwavespic=s=320x72:colors=0x5b8cff',
      '-frames:v', '1',
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
          reject(new Error('Tạo ảnh sóng âm quá 20 giây — đã huỷ'))
        }, 20_000)
        child.on('error', (e) => {
          clearTimeout(timer)
          reject(e)
        })
        child.on('close', (code) => {
          clearTimeout(timer)
          if (code === 0) resolve()
          else reject(new Error(`FFmpeg tạo sóng âm thoát mã ${code}: ${lastLine}`))
        })
      })
      if (!fs.existsSync(tmp)) throw new Error('Không tạo được ảnh sóng âm')
      const b64 = fs.readFileSync(tmp).toString('base64')
      return `data:image/png;base64,${b64}`
    } finally {
      try {
        fs.unlinkSync(tmp)
      } catch {
        /* file có thể chưa được tạo */
      }
    }
  })
}
