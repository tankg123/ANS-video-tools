import path from 'node:path'
import type { ModuleContext } from '../module-context'
import { encoderQualityArgs, releaseOutput } from '../util'
import type {
  IntroOutroLogoStartPayload,
  IntroOutroLogoStartResult,
  LogoPosition
} from '@shared/modules/intro-outro-logo'

/**
 * Module Chèn Intro / Outro / Logo (spec 4.4):
 * - Video chính hàng loạt: mỗi video = 1 task ffmpeg với filter_complex build từ probe.
 * - Intro/outro tự scale + pad về đúng độ phân giải/fps video chính rồi concat.
 * - Logo PNG: overlay theo vị trí (4 góc/giữa), kích thước % bề rộng, độ mờ,
 *   thời gian hiển thị (toàn bộ / between(t,S,E)).
 * - Overlay/concat bắt buộc re-encode video (meta.mode = 're-encode').
 */

/** Toạ độ overlay theo biến của filter overlay (main_w/main_h/overlay_w/overlay_h) */
const OVERLAY_POS: Record<LogoPosition, string> = {
  tl: '16:16',
  tr: 'main_w-overlay_w-16:16',
  bl: '16:main_h-overlay_h-16',
  br: 'main_w-overlay_w-16:main_h-overlay_h-16',
  center: '(main_w-overlay_w)/2:(main_h-overlay_h)/2'
}
const LOGO_POSITIONS = new Set<LogoPosition>(['tl', 'tr', 'bl', 'br', 'center'])

/** Chuẩn hoá audio để concat không lỗi khác sample rate / channel layout */
const AUDIO_NORM = 'asetpts=PTS-STARTPTS,aresample=44100,aformat=sample_fmts=fltp:channel_layouts=stereo'

const clamp = (v: number, min: number, max: number): number => Math.min(max, Math.max(min, v))

export default function register(ctx: ModuleContext): void {
  ctx.handle('mod:intro-outro-logo:start', async (p: IntroOutroLogoStartPayload): Promise<IntroOutroLogoStartResult> => {
    const inputs = (p?.inputs ?? []).filter(Boolean)
    if (!inputs.length) throw new Error('Chưa chọn video chính')

    const hasIntro = !!p.intro
    const hasOutro = !!p.outro
    const hasLogo = !!p.logo?.path
    if (!hasIntro && !hasOutro && !hasLogo) {
      throw new Error('Cần chọn ít nhất một trong: intro, outro hoặc logo')
    }
    const needConcat = hasIntro || hasOutro

    // ---- Logo options (clamp an toàn) ----
    let logoWidthPct = 15
    let logoAlpha = '1.000'
    let logoPos: LogoPosition = 'br'
    let logoEnable = '' // '' = toàn bộ video
    if (hasLogo && p.logo) {
      if (!Number.isFinite(p.logo.widthPct) || !Number.isFinite(p.logo.opacityPct)) {
        throw new Error('Kích thước hoặc độ mờ logo không hợp lệ')
      }
      if (!LOGO_POSITIONS.has(p.logo.position)) throw new Error('Vị trí logo không hợp lệ')
      logoWidthPct = clamp(p.logo.widthPct, 1, 100)
      logoAlpha = (clamp(p.logo.opacityPct, 0, 100) / 100).toFixed(3)
      logoPos = p.logo.position
      if (!p.logo.fullDuration) {
        const rawStart = p.logo.startSec ?? 0
        const rawEnd = p.logo.endSec ?? 0
        if (!Number.isFinite(rawStart) || !Number.isFinite(rawEnd)) {
          throw new Error('Khoảng hiển thị logo không hợp lệ')
        }
        const s = Math.max(0, rawStart)
        const e = rawEnd
        if (!(e > s)) {
          throw new Error('Khoảng hiển thị logo không hợp lệ: giây kết thúc phải lớn hơn giây bắt đầu')
        }
        logoEnable = `:enable='between(t,${s},${e})'`
      }
    }

    // ---- Probe intro/outro một lần (dùng chung cho mọi video chính) ----
    const introInfo = hasIntro ? await ctx.probe(p.intro!) : null
    const outroInfo = hasOutro ? await ctx.probe(p.outro!) : null
    if (introInfo && !introInfo.video) throw new Error(`File intro không có luồng video: ${path.basename(p.intro!)}`)
    if (outroInfo && !outroInfo.video) throw new Error(`File outro không có luồng video: ${path.basename(p.outro!)}`)
    // Concat cần đủ cặp (video, audio) — thiếu audio thì báo lỗi rõ ràng
    if (introInfo && !introInfo.audio) throw new Error('Intro cần có audio để ghép với video chính')
    if (outroInfo && !outroInfo.audio) throw new Error('Outro cần có audio để ghép với video chính')

    const enc = await ctx.pickEncoder('h264')
    const encArgs = encoderQualityArgs(enc, 18)

    // ---- Giai đoạn 1: probe + build args cho TẤT CẢ video chính (lỗi thì không enqueue gì) ----
    const jobs: { title: string; args: string[]; durationSec: number; output: string }[] = []
    try {
      for (const input of inputs) {
      const info = await ctx.probe(input)
      if (!info.video) throw new Error(`File không có luồng video: ${path.basename(input)}`)
      if (needConcat && !info.audio) {
        throw new Error(`Video chính cần có audio để ghép intro/outro: ${path.basename(input)}`)
      }
      const W = info.video.width
      const H = info.video.height
      const F = Number.isFinite(info.video.fps) && info.video.fps > 0 ? Number(info.video.fps.toFixed(3)) : 30

      // Inputs theo thứ tự: main, [intro], [outro], [logo]
      const inputArgs: string[] = ['-i', input]
      let idx = 1
      let introIdx = -1
      let outroIdx = -1
      let logoIdx = -1
      if (hasIntro) {
        introIdx = idx++
        inputArgs.push('-i', p.intro!)
      }
      if (hasOutro) {
        outroIdx = idx++
        inputArgs.push('-i', p.outro!)
      }
      if (hasLogo) {
        logoIdx = idx++
        inputArgs.push('-i', p.logo!.path)
      }

      const parts: string[] = []
      let mainV: string

      // Nhánh video chính (+ logo nếu có)
      if (hasLogo) {
        const lw = Math.max(2, Math.round((W * logoWidthPct) / 100))
        parts.push(`[0:v]setpts=PTS-STARTPTS,fps=${F},setsar=1[mv0]`)
        parts.push(`[${logoIdx}:v]scale=${lw}:-1,format=rgba,colorchannelmixer=aa=${logoAlpha}[lg]`)
        parts.push(`[mv0][lg]overlay=${OVERLAY_POS[logoPos]}${logoEnable},format=yuv420p[mv]`)
        mainV = '[mv]'
      } else {
        parts.push(`[0:v]setpts=PTS-STARTPTS,fps=${F},setsar=1,format=yuv420p[mv]`)
        mainV = '[mv]'
      }

      let maps: string[]
      let audioArgs: string[]
      let durationSec: number

      if (needConcat) {
        // Intro/outro: scale + pad về đúng WxH, fps, chuẩn hoá audio, rồi concat
        parts.push(`[0:a]${AUDIO_NORM}[ma]`)
        const pairs: string[] = []
        if (hasIntro) {
          parts.push(
            `[${introIdx}:v]setpts=PTS-STARTPTS,scale=${W}:${H}:force_original_aspect_ratio=decrease,` +
              `pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=${F},format=yuv420p[iv]`
          )
          parts.push(`[${introIdx}:a]${AUDIO_NORM}[ia]`)
          pairs.push('[iv][ia]')
        }
        pairs.push(`${mainV}[ma]`)
        if (hasOutro) {
          parts.push(
            `[${outroIdx}:v]setpts=PTS-STARTPTS,scale=${W}:${H}:force_original_aspect_ratio=decrease,` +
              `pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=${F},format=yuv420p[ov]`
          )
          parts.push(`[${outroIdx}:a]${AUDIO_NORM}[oa]`)
          pairs.push('[ov][oa]')
        }
        parts.push(`${pairs.join('')}concat=n=${pairs.length}:v=1:a=1[outv][outa]`)
        maps = ['-map', '[outv]', '-map', '[outa]']
        audioArgs = ['-c:a', 'aac', '-b:a', '192k']
        durationSec = (introInfo?.durationSec ?? 0) + info.durationSec + (outroInfo?.durationSec ?? 0)
      } else {
        // Chỉ logo: không concat, chỉ overlay; audio giữ nguyên (copy nếu đã AAC)
        maps = ['-map', mainV, '-map', '0:a?']
        audioArgs = info.audio?.codec === 'aac' ? ['-c:a', 'copy'] : ['-c:a', 'aac', '-b:a', '192k']
        durationSec = info.durationSec
      }

      const output = ctx.deriveOutput(input, '_branded', p.outputDir, '.mp4')
      const args = [
        ...inputArgs,
        '-filter_complex', parts.join(';'),
        ...maps,
        '-c:v', enc,
        ...encArgs,
        ...audioArgs,
        output
      ]

      const tags = [hasIntro && 'intro', hasOutro && 'outro', hasLogo && 'logo'].filter(Boolean).join('+')
        jobs.push({ title: `Chèn ${tags}: ${path.basename(input)}`, args, durationSec, output })
      }
    } catch (error) {
      for (const job of jobs) releaseOutput(job.output)
      throw error
    }

    // ---- Giai đoạn 2: enqueue toàn bộ ----
    return jobs.map((j) =>
      ctx.enqueueFfmpeg({
        type: 'intro-outro-logo',
        title: j.title,
        args: j.args,
        durationSec: j.durationSec,
        outputPath: j.output,
        meta: { mode: 're-encode' }
      })
    )
  })
}
