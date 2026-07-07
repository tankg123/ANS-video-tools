import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import type { ModuleContext } from '../module-context'
import type {
  CookieConfig,
  DlItem,
  DlQuality,
  DownloadPayload,
  DownloadResult,
  FetchInfoPayload,
  FetchInfoResult
} from '@shared/modules/downloader'

/**
 * Module Tải Video (spec 4.10):
 * - fetchInfo: yt-dlp -J --flat-playlist → metadata (KHÔNG tải file), phân giải playlist/kênh
 * - download: enqueueYtdlp từng item vào pool 'download' (settings.maxDownloads enforce song song)
 * - stopAll: huỷ toàn bộ pool download
 */

const FETCH_TIMEOUT_MS = 90_000

/** Cấu trúc JSON thô từ yt-dlp -J (chỉ các field cần dùng) */
interface RawEntry {
  _type?: string
  id?: string
  url?: string
  webpage_url?: string
  title?: string
  duration?: number | null
  thumbnail?: string
  thumbnails?: { url?: string }[]
  uploader?: string
  channel?: string
  filesize_approx?: number | null
  filesize?: number | null
  entries?: (RawEntry | null)[]
}

function cookieArgs(cookies?: CookieConfig): string[] {
  if (!cookies || cookies.mode === 'none') return []
  if (cookies.mode === 'file' && cookies.file) return ['--cookies', cookies.file]
  if (cookies.mode === 'browser' && cookies.browser) return ['--cookies-from-browser', cookies.browser]
  return []
}

function entryToItem(e: RawEntry): DlItem | null {
  const url =
    e.url || e.webpage_url || (e.id ? `https://www.youtube.com/watch?v=${e.id}` : '')
  if (!url) return null
  return {
    id: e.id || randomUUID(),
    url,
    title: e.title || url,
    durationSec: typeof e.duration === 'number' && e.duration > 0 ? e.duration : undefined,
    thumbnail: e.thumbnails?.at(-1)?.url || e.thumbnail || undefined,
    uploader: e.uploader || e.channel || undefined,
    filesizeApprox:
      (typeof e.filesize_approx === 'number' && e.filesize_approx) ||
      (typeof e.filesize === 'number' && e.filesize) ||
      undefined,
    quality: 'best',
    status: 'idle'
  }
}

/** Kênh YouTube có thể trả entries lồng nhau (tab Videos/Shorts/Live) → flatten đệ quy */
function flattenEntries(root: RawEntry, out: DlItem[]): void {
  if (Array.isArray(root.entries)) {
    for (const e of root.entries) {
      if (!e) continue
      if (Array.isArray(e.entries)) flattenEntries(e, out)
      else {
        const it = entryToItem(e)
        if (it) out.push(it)
      }
    }
  } else {
    const it = entryToItem(root)
    if (it) out.push(it)
  }
}

/** args format theo chất lượng đã chọn */
function qualityArgs(q: DlQuality): string[] {
  if (q === 'mp3') return ['-x', '--audio-format', 'mp3']
  if (q === 'm4a') return ['-x', '--audio-format', 'm4a']
  if (q === 'best') return ['-f', 'bv*+ba/b', '--merge-output-format', 'mp4']
  const h = parseInt(q, 10)
  return ['-f', `bv*[height<=${h}]+ba/b[height<=${h}]`, '--merge-output-format', 'mp4']
}

export default function register(ctx: ModuleContext): void {
  // ---- Lấy metadata (không tải file) — chạy trực tiếp, KHÔNG qua queue ----
  ctx.handle('mod:downloader:fetchInfo', async (p: FetchInfoPayload): Promise<FetchInfoResult> => {
    const url = (p?.url ?? '').trim()
    if (!url) throw new Error('Chưa nhập link video / playlist / kênh')
    const bin = ctx.resolveBin('yt-dlp')
    if (!bin) throw new Error('Không tìm thấy yt-dlp — hãy tải binaries trong mục "Kiểm tra cập nhật"')

    const args = ['-J', '--flat-playlist', '--no-warnings', ...cookieArgs(p.cookies), url]

    const stdout = await new Promise<string>((resolve, reject) => {
      const outLines: string[] = []
      let lastError = ''
      let settled = false
      const { child } = ctx.pm.spawnManaged(bin, args, {
        onLine: (line, stream) => {
          if (stream === 'out') outLines.push(line)
          else if (/ERROR/i.test(line)) lastError = line.replace(/^ERROR:\s*/i, '').trim()
        }
      })
      const timer = setTimeout(() => {
        if (settled) return
        settled = true
        ctx.pm.killTree(child.pid)
        reject(new Error('Hết thời gian lấy thông tin (90s) — kiểm tra link/mạng hoặc dùng cookies'))
      }, FETCH_TIMEOUT_MS)
      child.on('error', (e) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        reject(e)
      })
      child.on('close', (code) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        if (code !== 0) {
          reject(new Error(lastError || `yt-dlp thoát mã ${code} khi lấy thông tin`))
        } else resolve(outLines.join('\n'))
      })
    })

    let parsed: RawEntry
    try {
      parsed = JSON.parse(stdout) as RawEntry
    } catch {
      throw new Error('Không đọc được thông tin video (JSON không hợp lệ) — thử lại hoặc cập nhật yt-dlp')
    }

    const items: DlItem[] = []
    flattenEntries(parsed, items)
    if (items.length === 0) throw new Error('Không tìm thấy video nào từ link này')
    return { items }
  })

  // ---- Đưa các item vào hàng đợi download ----
  ctx.handle('mod:downloader:download', async (p: DownloadPayload): Promise<DownloadResult> => {
    const items = p?.items ?? []
    if (items.length === 0) throw new Error('Không có video nào để tải')
    const downloadDir = (p.downloadDir || ctx.settings.get('downloadDir') || '').trim()
    if (!downloadDir) throw new Error('Chưa chọn thư mục lưu')
    try {
      fs.mkdirSync(downloadDir, { recursive: true })
    } catch {
      throw new Error(`Không tạo được thư mục lưu: ${downloadDir}`)
    }
    const cArgs = cookieArgs(p.cookies)
    const outTpl = path.join(downloadDir, '%(title)s [%(id)s].%(ext)s')

    const results: DownloadResult = []
    for (const item of items) {
      if (!item?.url) continue
      const args = [
        ...qualityArgs(item.quality),
        '--newline',
        '--no-playlist',
        '--concurrent-fragments', '4',
        '--no-mtime',
        '-o', outTpl,
        ...cArgs,
        item.url
      ]
      const taskId = ctx.enqueueYtdlp({
        type: 'downloader',
        title: `Tải: ${item.title || item.url}`,
        args,
        meta: { itemId: item.id, quality: item.quality },
        onLine: (line, api) => {
          // '-x' chuyển đổi audio: bắt file đích cuối cùng (parser mặc định chỉ bắt [download]/[Merger])
          const m = /^\[ExtractAudio\]\s+Destination:\s+(.+)$/.exec(line)
          if (m) api.update({ outputPath: m[1].trim(), detail: 'Đang trích xuất âm thanh...' })
        }
      })
      results.push({ itemId: item.id, taskId })
    }
    if (results.length === 0) throw new Error('Không có video hợp lệ để tải')
    return results
  })

  // ---- Dừng tất cả download (queued + running) ----
  ctx.handle('mod:downloader:stopAll', async (): Promise<number> => {
    return ctx.queue.cancelPools(['download'])
  })
}
