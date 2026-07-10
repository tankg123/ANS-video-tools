import type { TaskPool } from '@shared/types'
import { resolveBin } from './binaries'
import { logger } from './logger'
import { pm } from './process-manager'
import { clampPct, ffmpegEta, parseFfmpegLine, parseYtdlpLine } from './progress-parser'
import { queue, TaskApi } from './task-queue'

export interface FfmpegTaskOptions {
  type: string
  title: string
  args: string[]
  /** tổng thời lượng output (giây) để tính %; bỏ trống = indeterminate */
  durationSec?: number
  pool?: TaskPool
  outputPath?: string
  meta?: Record<string, unknown>
  cwd?: string
  /** không tự thêm -y (vd lệnh không ghi file) */
  noOverwriteFlag?: boolean
}

/** Chạy 1 process và trả promise theo chuẩn task (dùng chung cho ffmpeg/yt-dlp). */
export function runProcessTask(
  api: TaskApi,
  bin: string,
  args: string[],
  opts: { cwd?: string; tag?: string; onLine: (line: string) => void }
): Promise<number> {
  return new Promise((resolve, reject) => {
    const { child } = pm.spawnManaged(bin, args, {
      cwd: opts.cwd,
      tag: opts.tag,
      onLine: (line) => opts.onLine(line)
    })
    api.update({ pid: child.pid })
    api.setCancelHook(() => pm.killTree(child.pid))
    child.on('error', (e) => reject(e))
    child.on('close', (code) => resolve(code ?? -1))
  })
}

/**
 * Đưa 1 lệnh FFmpeg vào hàng đợi. Trả về task id.
 * - progress parse từ stderr (time=/speed=) — spec 5.3
 * - log từng dòng vào logs/<taskId>.log
 */
export function enqueueFfmpeg(o: FfmpegTaskOptions): string {
  return queue.add({
    type: o.type,
    title: o.title,
    pool: o.pool ?? 'ffmpeg',
    meta: o.meta,
    run: async (api) => {
      const bin = resolveBin('ffmpeg')
      if (!bin) throw new Error('Không tìm thấy FFmpeg — hãy tải binaries trong mục "Kiểm tra cập nhật"')
      const log = logger.create(api.id)
      const fullArgs = ['-hide_banner', '-nostdin', ...(o.noOverwriteFlag ? [] : ['-y']), ...o.args]
      api.update({ logFile: log.file, outputPath: o.outputPath, progress: o.durationSec ? 0 : -1 })
      log.write(`CMD: ffmpeg ${fullArgs.join(' ')}`)
      let lastLine = ''
      try {
        const code = await runProcessTask(api, bin, fullArgs, {
          cwd: o.cwd,
          tag: o.pool ?? 'ffmpeg',
          onLine: (line) => {
            log.write(line)
            if (line.trim()) lastLine = line.trim()
            const p = parseFfmpegLine(line)
            if (p) {
              const patch: Record<string, unknown> = {
                speed: p.speed ? `${p.speed}x` : undefined,
                detail: [p.fps ? `${p.fps} fps` : '', p.bitrate ?? ''].filter(Boolean).join(' · ') || undefined
              }
              if (o.durationSec && o.durationSec > 0) {
                patch.progress = clampPct((p.timeSec / o.durationSec) * 100)
                patch.eta = ffmpegEta(o.durationSec, p.timeSec, p.speed)
              }
              api.update(patch)
            }
          }
        })
        if (api.isCancelled()) return
        if (code !== 0) throw new Error(`FFmpeg thoát mã ${code}: ${lastLine}`)
      } finally {
        log.close()
      }
    }
  })
}

export interface YtdlpTaskOptions {
  type?: string
  title: string
  args: string[]
  meta?: Record<string, unknown>
  cwd?: string
  /** callback mỗi dòng (module downloader dùng để bắt destination...) */
  onLine?: (line: string, api: TaskApi) => void
}

/** Đưa 1 lệnh yt-dlp vào hàng đợi download. Trả về task id. */
export function enqueueYtdlp(o: YtdlpTaskOptions): string {
  return queue.add({
    type: o.type ?? 'download',
    title: o.title,
    pool: 'download',
    meta: o.meta,
    run: async (api) => {
      const bin = resolveBin('yt-dlp')
      if (!bin) throw new Error('Không tìm thấy yt-dlp — hãy tải binaries trong mục "Kiểm tra cập nhật"')
      const ffmpegBin = resolveBin('ffmpeg')
      const log = logger.create(api.id)
      const fullArgs = [...o.args]
      // yt-dlp cần ffmpeg để merge video+audio
      if (ffmpegBin && !fullArgs.includes('--ffmpeg-location')) {
        fullArgs.push('--ffmpeg-location', ffmpegBin)
      }
      api.update({ logFile: log.file })
      log.write(`CMD: yt-dlp ${fullArgs.join(' ')}`)
      let lastLine = ''
      let sawError = false
      try {
        const code = await runProcessTask(api, bin, fullArgs, {
          cwd: o.cwd,
          tag: 'download',
          onLine: (line) => {
            log.write(line)
            if (line.trim()) lastLine = line.trim()
            if (/^ERROR:/i.test(line)) sawError = true
            const p = parseYtdlpLine(line)
            if (p) {
              if (p.percent !== undefined) {
                api.update({
                  progress: clampPct(p.percent),
                  speed: p.rate,
                  eta: p.eta,
                  detail: p.totalSize ? `~${p.totalSize}` : undefined
                })
              }
              if (p.destination) api.update({ outputPath: p.destination })
              if (p.merging) api.update({ outputPath: p.merging, detail: 'Đang ghép luồng...' })
              if (p.alreadyDone) api.update({ progress: 100, detail: 'Đã tải trước đó' })
            }
            o.onLine?.(line, api)
          }
        })
        if (api.isCancelled()) return
        if (code !== 0 || sawError) throw new Error(`yt-dlp lỗi: ${lastLine}`)
      } finally {
        log.close()
      }
    }
  })
}

/** Nút đỏ KILL ALL FFMPEG (spec mục 2) — KHÔNG đụng pool/process tải video ('download'). */
export async function killAllFfmpeg(): Promise<{ cancelledTasks: number; killedProcesses: number }> {
  const cancelledTasks = queue.cancelPools(['ffmpeg', 'misc'])
  const killedProcesses = pm.killAllTracked(new Set(['download']))
  const orphans = await pm.orphanCleanup()
  return { cancelledTasks, killedProcesses: killedProcesses + orphans }
}
