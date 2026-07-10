import path from 'node:path'
import type { ModuleContext } from '../module-context'
import type {
  RenderEncoderPayload,
  RenderEncoderResult,
  RenderStartPayload,
  RenderStartResult
} from '@shared/modules/render'

/**
 * Module Render H264/H265 (spec 4.3):
 * - Render hàng loạt: mỗi file 1 task ffmpeg trong TaskQueue (pool 'ffmpeg')
 * - Encoder tự dò qua ctx.pickEncoder (NVENC → QSV → AMF → libx264/libx265)
 * - NVENC: decode CUDA + scale_cuda (spec 5.1) — CHỈ khi codec nguồn có NVDEC và pixFmt 8-bit,
 *   ngược lại decode phần mềm để không fail (NVDEC không hỗ trợ / h264_nvenc không encode 10-bit)
 * - Probe trước để lấy durationSec → TaskTable hiện % + speed (spec 5.3)
 */

const SW_PRESETS = new Set(['ultrafast', 'superfast', 'veryfast', 'faster', 'fast', 'medium', 'slow'])
const NV_PRESETS = new Set(['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7'])

/** Codec nguồn mà NVDEC decode được trên GPU (cuda-path) */
const NVDEC_CODECS = new Set(['h264', 'hevc', 'vp9', 'av1', 'mpeg2video', 'vc1'])

/** pixFmt 8-bit 4:2:0 (yuv420p/nv12...) — loại 10/12-bit và 4:2:2/4:4:4 */
const is8Bit420 = (pixFmt: string): boolean =>
  pixFmt !== '' && !['10le', '12le', '422', '444'].some((s) => pixFmt.includes(s))

/** Audio codec copy được vào container MP4 mà không lỗi mux */
const MP4_AUDIO_OK = new Set(['aac', 'mp3', 'ac3', 'eac3', 'alac', 'mp2'])

/** format số gọn cho bitrate (8 → '8', 2.5 → '2.5') */
const numStr = (n: number): string => String(Math.round(n * 100) / 100)

export default function register(ctx: ModuleContext): void {
  // UI hỏi encoder sẽ dùng để hiển thị (vd 'NVENC ✅')
  ctx.handle('mod:render:encoder', async (p: RenderEncoderPayload): Promise<RenderEncoderResult> => {
    const encoder = await ctx.pickEncoder(p?.codec === 'hevc' ? 'hevc' : 'h264')
    return { encoder }
  })

  ctx.handle('mod:render:start', async (p: RenderStartPayload): Promise<RenderStartResult> => {
    const inputs = (p?.inputs ?? []).filter(Boolean)
    if (!inputs.length) throw new Error('Chưa có file nào trong danh sách render')
    const o = p?.options
    if (!o) throw new Error('Thiếu thiết lập render')
    if (!new Set(['h264', 'hevc']).has(o.codec)) throw new Error('Codec render không hợp lệ')
    if (!new Set(['crf', 'bitrate']).has(o.qualityMode)) throw new Error('Chế độ chất lượng không hợp lệ')
    if (!new Set(['keep', 2160, 1440, 1080, 720, 480]).has(o.resolution)) {
      throw new Error('Độ phân giải đầu ra không hợp lệ')
    }
    if (!new Set(['keep', 24, 30, 60]).has(o.fps)) throw new Error('FPS đầu ra không hợp lệ')
    if (!new Set(['copy', 'aac192']).has(o.audio)) throw new Error('Thiết lập audio không hợp lệ')
    if (!Number.isFinite(o.crf) || !Number.isFinite(o.bitrateMbps)) {
      throw new Error('Thông số chất lượng không hợp lệ')
    }
    const codec = o.codec === 'hevc' ? 'hevc' : 'h264'
    const enc = await ctx.pickEncoder(codec)
    const isNvenc = enc.includes('nvenc')
    const isSw = enc === 'libx264' || enc === 'libx265'

    const crf = Math.min(51, Math.max(0, Math.round(Number(o.crf) || 23)))
    const mbps = Math.max(0.2, Math.min(200, Number(o.bitrateMbps) || 8))
    const preset = (o.preset ?? '').trim()

    const taskIds: string[] = []
    const skipped: string[] = []

    for (const input of inputs) {
      // Probe trước: durationSec (tính %), audio codec (copy hay AAC), video codec + pixFmt (gate cuda-path)
      let durationSec = 0
      let srcAudio = ''
      let srcVideo = ''
      let srcPixFmt = ''
      try {
        const info = await ctx.probe(input)
        durationSec = info.durationSec
        srcAudio = info.audio?.codec?.toLowerCase() ?? ''
        srcVideo = info.video?.codec?.toLowerCase() ?? ''
        srcPixFmt = info.video?.pixFmt?.toLowerCase() ?? ''
      } catch {
        skipped.push(input)
        continue
      }

      // Cuda-path chỉ khi NVDEC decode được codec nguồn VÀ nguồn 8-bit 4:2:0
      // (10-bit/4:2:2/codec lạ → decode phần mềm thay vì fail)
      const useCuda = isNvenc && NVDEC_CODECS.has(srcVideo) && is8Bit420(srcPixFmt)

      const args: string[] = []
      // NVENC: decode trên GPU (spec 5.1)
      if (useCuda) args.push('-hwaccel', 'cuda', '-hwaccel_output_format', 'cuda')
      args.push('-i', input)
      // Chỉ map video đầu + audio đầu (bỏ subtitle/attachment gây lỗi mux MP4)
      args.push('-map', '0:v:0', '-map', '0:a:0?')

      if (o.fps !== 'keep') args.push('-r', String(o.fps))
      if (o.resolution !== 'keep') {
        const h = Number(o.resolution)
        args.push('-vf', useCuda ? `scale_cuda=-2:${h}` : `scale=-2:${h}`)
      }
      // Decode phần mềm: chuẩn hoá 8-bit cho encoder hw hoặc đích h264 (h264_nvenc/libx264 không encode 10-bit);
      // libx265 giữ nguyên pixFmt nguồn (encode được 10-bit)
      if (!useCuda && (!isSw || codec === 'h264')) args.push('-pix_fmt', 'yuv420p')

      args.push('-c:v', enc)

      // Preset theo họ encoder
      if (isSw) args.push('-preset', SW_PRESETS.has(preset) ? preset : 'veryfast')
      else if (isNvenc) args.push('-preset', NV_PRESETS.has(preset) ? preset : 'p4')
      // qsv/amf: không thêm -preset (tên preset khác nhau, dùng mặc định của encoder)

      // Chất lượng
      if (o.qualityMode === 'bitrate') {
        args.push('-b:v', `${numStr(mbps)}M`, '-maxrate', `${numStr(mbps)}M`, '-bufsize', `${numStr(mbps * 2)}M`)
      } else if (isSw) {
        args.push('-crf', String(crf))
      } else if (isNvenc) {
        // nvenc: constant quality thật sự cần -b:v 0 (mặc định nvenc cap 2Mbps)
        args.push('-rc', 'vbr', '-cq', String(crf), '-b:v', '0')
      } else {
        // qsv/amf: map CRF sang global quality đơn giản hoá
        args.push('-q:v', String(crf))
      }

      if (codec === 'hevc') args.push('-tag:v', 'hvc1')

      // Audio: copy nếu hợp lệ với MP4, ngược lại (hoặc chọn AAC) → AAC 192k
      const audioCopyOk = o.audio === 'copy' && (!srcAudio || MP4_AUDIO_OK.has(srcAudio))
      if (audioCopyOk) args.push('-c:a', 'copy')
      else args.push('-c:a', 'aac', '-b:a', '192k')

      args.push('-movflags', '+faststart')

      const output = ctx.deriveOutput(input, codec === 'hevc' ? '_h265' : '_h264', o.outputDir, '.mp4')
      args.push(output)

      taskIds.push(
        ctx.enqueueFfmpeg({
          type: 'render',
          title: `Render ${codec === 'hevc' ? 'H265' : 'H264'}: ${path.basename(input)}`,
          args,
          durationSec: durationSec > 0 ? durationSec : undefined,
          outputPath: output,
          meta: { mode: 're-encode', encoder: enc, audio: audioCopyOk ? 'copy' : 'aac' }
        })
      )
    }

    if (!taskIds.length) throw new Error('Không đọc được file nào trong danh sách (probe thất bại)')
    return { taskIds, skipped }
  })
}
