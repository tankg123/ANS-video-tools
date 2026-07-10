import path from 'node:path'
import type { MediaInfo } from '@shared/types'
import type {
  RemoveAudioStartPayload,
  RemoveAudioStartResult
} from '@shared/modules/remove-audio'
import type { ModuleContext } from '../module-context'

interface Inspection {
  input: string
  info?: MediaInfo
}

async function mapConcurrent<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let cursor = 0
  const workerCount = Math.min(items.length, Math.max(1, Math.floor(limit)))

  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (cursor < items.length) {
        const index = cursor++
        results[index] = await fn(items[index])
      }
    })
  )
  return results
}

/**
 * Remove every audio stream without re-encoding the video.
 * Each input becomes an independent FFmpeg task, so TaskQueue runs the batch
 * in parallel according to the global maxFfmpeg setting.
 */
export default function register(ctx: ModuleContext): void {
  ctx.handle(
    'mod:remove-audio:start',
    async (p: RemoveAudioStartPayload): Promise<RemoveAudioStartResult> => {
      const unique = new Map<string, string>()
      for (const value of p?.inputs ?? []) {
        const input = value?.trim()
        if (input && !unique.has(input.toLowerCase())) unique.set(input.toLowerCase(), input)
      }
      const inputs = [...unique.values()]
      if (!inputs.length) throw new Error('Chưa có video nào trong danh sách')

      const probeConcurrency = Math.min(8, Math.max(1, ctx.settings.get('maxFfmpeg')))
      const inspections = await mapConcurrent<string, Inspection>(
        inputs,
        probeConcurrency,
        async (input) => {
          if (!ctx.isVideoFile(input)) return { input }
          try {
            return { input, info: await ctx.probe(input) }
          } catch {
            return { input }
          }
        }
      )

      const taskIds: string[] = []
      const skipped: string[] = []
      const alreadySilent: string[] = []
      const reservedOutputs = new Set<string>()

      for (const { input, info } of inspections) {
        if (!info?.video) {
          skipped.push(input)
          continue
        }
        if (!info.audio) {
          alreadySilent.push(input)
          continue
        }

        let suffix = '_no_audio'
        let output = ctx.deriveOutput(input, suffix, p.outputDir)
        let copy = 1
        while (reservedOutputs.has(output.toLowerCase())) {
          suffix = `_no_audio (${copy++})`
          output = ctx.deriveOutput(input, suffix, p.outputDir)
        }
        reservedOutputs.add(output.toLowerCase())

        taskIds.push(
          ctx.enqueueFfmpeg({
            type: 'remove-audio',
            title: `Xóa audio: ${path.basename(input)}`,
            args: [
              '-i',
              input,
              '-map',
              '0',
              '-map',
              '-0:a',
              '-c',
              'copy',
              '-an',
              output
            ],
            durationSec: info.durationSec > 0 ? info.durationSec : undefined,
            outputPath: output,
            meta: { mode: 'stream-copy', audio: 'removed' }
          })
        )
      }

      if (!taskIds.length && !alreadySilent.length) {
        throw new Error('Không đọc được video hợp lệ nào trong danh sách')
      }
      return { taskIds, skipped, alreadySilent }
    }
  )
}
