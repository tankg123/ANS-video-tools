import { app, net } from 'electron'
import type { ModuleContext } from '../module-context'
import type { UpdaterCheckResult } from '@shared/modules/updater'

/**
 * Module Kiểm tra cập nhật (spec 4.11):
 * - 'mod:updater:check'  — GET settings.updateUrl (định dạng GitHub Releases API),
 *   so sánh semver với app.getVersion() → changelog + link tải bản mới
 * - 'mod:updater:ytdlp'  — chạy 'yt-dlp -U' (task pool 'misc', type 'ytdlp-update')
 * Trạng thái/tải binaries dùng core sẵn có: core:bins:status / core:bins:fetch.
 */

/** JSON tối thiểu của GitHub release (updateUrl có thể trỏ .../releases/latest hoặc .../releases) */
interface GithubReleaseJson {
  tag_name?: string
  name?: string
  body?: string
  html_url?: string
  assets?: { name?: string; browser_download_url?: string }[]
}

/** 'v1.2.10' → [1, 2, 10]; chuỗi không có số → [] */
function verParts(v: string): number[] {
  const m = String(v).trim().replace(/^v/i, '').match(/\d+(?:\.\d+)*/)
  return m ? m[0].split('.').map((n) => parseInt(n, 10)) : []
}

/** So sánh semver đơn giản: >0 nếu a > b */
function cmpVer(a: string, b: string): number {
  const pa = verParts(a)
  const pb = verParts(b)
  const len = Math.max(pa.length, pb.length)
  for (let i = 0; i < len; i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (d !== 0) return d > 0 ? 1 : -1
  }
  return 0
}

export default function register(ctx: ModuleContext): void {
  // ---- 4.11a: kiểm tra phiên bản ứng dụng ----
  ctx.handle('mod:updater:check', async (): Promise<UpdaterCheckResult> => {
    const current = app.getVersion()
    const url = (ctx.settings.all().updateUrl ?? '').trim()
    if (!url) return { configured: false, current }

    let res: Awaited<ReturnType<typeof net.fetch>>
    try {
      res = await net.fetch(url, {
        headers: { Accept: 'application/vnd.github+json' },
        signal: AbortSignal.timeout(15000)
      })
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      throw new Error(`Không thể kết nối máy chủ cập nhật: ${msg}`)
    }
    if (!res.ok) throw new Error(`Máy chủ cập nhật trả về HTTP ${res.status}`)

    let release: GithubReleaseJson
    try {
      const parsed = (await res.json()) as GithubReleaseJson | GithubReleaseJson[]
      // updateUrl trỏ .../releases (mảng) thì lấy release mới nhất (phần tử đầu)
      release = Array.isArray(parsed) ? (parsed[0] ?? {}) : parsed
    } catch {
      throw new Error('Phản hồi không phải JSON hợp lệ (cần định dạng GitHub Releases API)')
    }

    const latestRaw = release.tag_name || release.name || ''
    if (!latestRaw) {
      throw new Error('Không tìm thấy tag_name trong phản hồi — kiểm tra lại URL cập nhật trong Cài đặt')
    }
    const latest = latestRaw.replace(/^v/i, '')
    const link =
      release.html_url ||
      release.assets?.find((a) => a.browser_download_url)?.browser_download_url ||
      ''
    return {
      configured: true,
      current,
      latest,
      changelog: release.body ?? '',
      url: link,
      hasUpdate: cmpVer(latest, current) > 0
    }
  })

  // ---- 4.11b: cập nhật yt-dlp ('yt-dlp -U') — site đổi API liên tục ----
  ctx.handle('mod:updater:ytdlp', async () => {
    const bin = ctx.resolveBin('yt-dlp')
    if (!bin) throw new Error('Không tìm thấy yt-dlp — hãy bấm "Tải FFmpeg + yt-dlp" trước')
    return ctx.queue.add({
      type: 'ytdlp-update',
      title: 'Cập nhật yt-dlp (yt-dlp -U)',
      pool: 'misc',
      run: (api) =>
        new Promise<void>((resolve, reject) => {
          api.update({ progress: -1, detail: 'Đang kiểm tra phiên bản yt-dlp...' })
          let lastLine = ''
          const { child } = ctx.pm.spawnManaged(bin, ['-U'], {
            onLine: (line) => {
              const s = line.trim()
              if (!s) return
              lastLine = s
              // queue đã throttle broadcast 4Hz nên update mỗi dòng là an toàn
              api.update({ detail: s.slice(0, 200) })
            }
          })
          api.update({ pid: child.pid })
          api.setCancelHook(() => ctx.pm.killTree(child.pid))
          child.on('error', (e) => reject(e))
          child.on('close', (code) => {
            if (api.isCancelled()) return resolve()
            if (code !== 0) return reject(new Error(`yt-dlp -U thoát mã ${code}: ${lastLine}`))
            api.update({ progress: 100, detail: lastLine || 'Hoàn tất' })
            resolve()
          })
        })
    })
  })
}
