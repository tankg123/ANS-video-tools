import fs from 'node:fs'
import path from 'node:path'
import type { ModuleContext } from '../module-context'
import type { SplitStartPayload, SplitStartResult } from '@shared/modules/split'

/**
 * Module Cắt chia nhỏ Video (spec 4.5):
 * - Mặc định `-c copy -f segment` (không re-encode → gần như tức thì)
 * - Tuỳ chọn re-encode chính xác từng frame (force_key_frames tại mốc chia)
 * - Chia theo thời lượng mỗi phần hoặc theo số phần (probe duration → segment_time)
 */

/** Sinh pattern output <dir>/<name>_part_%03d<ext>, tự tránh ghi đè phần cũ. */
function derivePattern(input: string, outDir?: string): { pattern: string; firstPart: string } {
  const dir = outDir && outDir.trim() ? outDir : path.dirname(input)
  const base = path.basename(input, path.extname(input))
  const ext = path.extname(input) || '.mp4'
  let tag = '_part_'
  let i = 1
  while (fs.existsSync(path.join(dir, `${base}${tag}000${ext}`))) {
    tag = `_part (${i})_`
    i++
  }
  return {
    pattern: path.join(dir, `${base}${tag}%03d${ext}`),
    firstPart: path.join(dir, `${base}${tag}000${ext}`)
  }
}

export default function register(ctx: ModuleContext): void {
  ctx.handle('mod:split:start', async (p: SplitStartPayload): Promise<SplitStartResult> => {
    if (!p || !Array.isArray(p.inputs) || p.inputs.length === 0) {
      throw new Error('Chưa chọn video nào')
    }
    if (p.mode === 'duration') {
      if (!(typeof p.minutesPerPart === 'number' && p.minutesPerPart > 0)) {
        throw new Error('Thời lượng mỗi phần phải lớn hơn 0')
      }
    } else if (p.mode === 'parts') {
      if (!(typeof p.parts === 'number' && Number.isInteger(p.parts) && p.parts >= 2)) {
        throw new Error('Số phần phải là số nguyên từ 2 trở lên')
      }
    } else {
      throw new Error('Chế độ chia không hợp lệ')
    }

    const enc = p.precise ? await ctx.pickEncoder('h264') : ''
    const taskIds: string[] = []
    const errors: string[] = []

    for (const input of p.inputs) {
      try {
        const info = await ctx.probe(input)
        const duration = info.durationSec || 0

        // segment_time (giây)
        let secs: number
        if (p.mode === 'parts') {
          if (!(duration > 0)) {
            throw new Error('Không đọc được thời lượng video — không thể chia theo số phần')
          }
          // +0.01 tránh sinh phần lẻ thừa do làm tròn
          secs = Math.ceil(duration / (p.parts as number)) + 0.01
        } else {
          secs = (p.minutesPerPart as number) * 60
          if (duration > 0 && secs >= duration) {
            throw new Error('Thời lượng mỗi phần lớn hơn hoặc bằng thời lượng video — không cần chia')
          }
        }

        const { pattern, firstPart } = derivePattern(input, p.outputDir)

        let args: string[]
        if (p.precise) {
          args = [
            '-i', input,
            '-c:v', enc,
            ...(enc === 'libx264' ? ['-preset', 'veryfast', '-crf', '18'] : ['-cq', '19']),
            '-c:a', 'aac',
            '-b:a', '192k',
            // ép keyframe đúng mốc chia để mỗi phần bắt đầu chính xác
            '-force_key_frames', `expr:gte(t,n_forced*${secs})`,
            '-f', 'segment',
            '-segment_time', String(secs),
            '-reset_timestamps', '1',
            pattern
          ]
        } else {
          args = [
            '-i', input,
            '-c', 'copy',
            '-map', '0',
            '-f', 'segment',
            '-segment_time', String(secs),
            '-reset_timestamps', '1',
            pattern
          ]
        }

        const expected = duration > 0 ? Math.max(1, Math.ceil(duration / secs)) : 0
        const id = ctx.enqueueFfmpeg({
          type: 'split',
          title: `Chia: ${path.basename(input)}${expected ? ` → ${expected} phần` : ''}`,
          args,
          // ffmpeg báo time= tổng toàn file khi segment → durationSec = duration toàn file
          durationSec: duration > 0 ? duration : undefined,
          outputPath: firstPart,
          meta: {
            mode: p.precise ? 're-encode' : 'copy',
            segmentTime: secs,
            expectedParts: expected || undefined
          }
        })
        taskIds.push(id)
      } catch (e) {
        errors.push(`${path.basename(input)}: ${e instanceof Error ? e.message : String(e)}`)
      }
    }

    if (taskIds.length === 0 && errors.length > 0) {
      throw new Error(errors.join('\n'))
    }
    return { taskIds, errors }
  })
}
