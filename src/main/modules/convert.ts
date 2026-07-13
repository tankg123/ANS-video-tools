import { randomUUID } from 'node:crypto'
import path from 'node:path'
import type { MediaInfo } from '@shared/types'
import type {
  ConvertOutputFormat,
  ConvertStartPayload,
  ConvertStartResult
} from '@shared/modules/convert'
import type { ModuleContext } from '../module-context'
import { encoderQualityArgs, ensureOutputDir, releaseOutput } from '../util'

interface Inspection {
  input: string
  info?: MediaInfo
}

const OUTPUT_FORMATS = new Set<ConvertOutputFormat>(['mp4', 'flv'])

interface PreparedTask {
  input: string
  info: MediaInfo
  output: string
  staging: string
  args: string[]
}

function convertQualityArgs(encoder: string, quality = 23): string[] {
  const value = String(quality)
  if (encoder === 'h264_qsv') return ['-global_quality', value]
  if (encoder === 'h264_amf') {
    return [
      '-quality',
      'quality',
      '-rc',
      'cqp',
      '-qp_i',
      value,
      '-qp_p',
      value,
      '-qp_b',
      value
    ]
  }
  return encoderQualityArgs(encoder, quality)
}

/**
 * Chuyển đổi hàng loạt sang H.264/AAC. Mỗi nguồn là một task riêng để TaskQueue
 * tự chạy song song theo giới hạn FFmpeg toàn cục và số CPU của máy.
 */
export default function register(ctx: ModuleContext): void {
  ctx.handle(
    'mod:convert:start',
    async (p: ConvertStartPayload): Promise<ConvertStartResult> => {
      if (!OUTPUT_FORMATS.has(p?.format)) {
        throw new Error('Định dạng đầu ra không hợp lệ. Chỉ hỗ trợ MP4 hoặc FLV')
      }

      const unique = new Map<string, string>()
      for (const value of p?.inputs ?? []) {
        const input = typeof value === 'string' ? value.trim() : ''
        if (input && !unique.has(input.toLowerCase())) unique.set(input.toLowerCase(), input)
      }
      const inputs = [...unique.values()]
      if (!inputs.length) throw new Error('Chưa có video nào trong danh sách')

      const outputDir = typeof p.outputDir === 'string' ? p.outputDir.trim() : ''
      if (outputDir) ensureOutputDir(outputDir)

      const inspections = await Promise.all(
        inputs.map(async (input): Promise<Inspection> => {
          if (!ctx.isVideoFile(input)) return { input }
          try {
            return { input, info: await ctx.probe(input) }
          } catch {
            return { input }
          }
        })
      )

      const valid = inspections.filter(
        (inspection): inspection is Inspection & { info: MediaInfo } => Boolean(inspection.info?.video)
      )
      const skipped = inspections
        .filter((inspection) => !inspection.info?.video)
        .map((inspection) => inspection.input)

      if (!valid.length) {
        throw new Error('Không đọc được video hợp lệ nào trong danh sách')
      }

      const encoder = await ctx.pickEncoder('h264')
      const format = p.format
      const prepared: PreparedTask[] = []
      const reservedOutputs: string[] = []
      try {
        for (const { input, info } of valid) {
          const output = ctx.deriveOutput(input, '_converted', outputDir, `.${format}`)
          reservedOutputs.push(output)
          const staging = path.join(path.dirname(output), `.ans-convert-${randomUUID()}.part`)
          const args = [
            '-i',
            input,
            '-map',
            '0:v:0',
            '-map',
            '0:a:0?',
            '-vf',
            'pad=ceil(iw/2)*2:ceil(ih/2)*2,format=yuv420p',
            '-c:v',
            encoder,
            ...convertQualityArgs(encoder)
          ]

          if (info.audio) {
            args.push('-c:a', 'aac', '-b:a', '192k')
            if (format === 'flv') args.push('-ar', '44100', '-ac', '2')
          } else {
            args.push('-an')
          }

          if (format === 'mp4') args.push('-movflags', '+faststart', '-f', 'mp4')
          else args.push('-f', 'flv')
          args.push(staging)
          prepared.push({ input, info, output, staging, args })
        }
      } catch (error) {
        for (const output of reservedOutputs) releaseOutput(output)
        throw error
      }

      const taskIds: string[] = []
      try {
        for (const task of prepared) {
          taskIds.push(
            ctx.enqueueFfmpeg({
              type: 'convert',
              title: `Chuyển sang ${format.toUpperCase()}: ${path.basename(task.input)}`,
              args: task.args,
              durationSec: task.info.durationSec > 0 ? task.info.durationSec : undefined,
              outputPath: task.output,
              stagingOutputPath: task.staging,
              meta: {
                mode: 're-encode',
                format,
                encoder,
                video: 'h264',
                audio: task.info.audio ? 'aac' : 'none'
              }
            })
          )
        }
      } catch (error) {
        for (const taskId of taskIds) ctx.queue.cancel(taskId)
        for (let index = taskIds.length; index < prepared.length; index++) {
          releaseOutput(prepared[index].output)
        }
        throw error
      }

      return { taskIds, skipped }
    }
  )
}
