/** '01:23:45.5' | '23:45' | '45' -> giây */
export function hmsToSec(s: string): number {
  const parts = String(s ?? '')
    .trim()
    .split(':')
    .map((p) => parseFloat(p))
  if (parts.some((n) => Number.isNaN(n) || n < 0)) return NaN
  let sec = 0
  for (const p of parts) sec = sec * 60 + p
  return sec
}

/** giây -> 'hh:mm:ss' */
export function secToHms(sec: number, withMs = false): string {
  if (!Number.isFinite(sec) || sec < 0) sec = 0
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = sec % 60
  const ss = withMs ? s.toFixed(1).padStart(4, '0') : String(Math.floor(s)).padStart(2, '0')
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${ss}`
}

/** bytes -> '1.2 GB' */
export function fmtBytes(n?: number): string {
  if (!n || !Number.isFinite(n) || n <= 0) return '—'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let i = 0
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024
    i++
  }
  return `${n >= 100 ? Math.round(n) : n.toFixed(1)} ${units[i]}`
}

/** ms -> '1g 02p 03s' kiểu đồng hồ đã phát */
export function fmtElapsed(ms: number): string {
  const sec = Math.max(0, Math.floor(ms / 1000))
  return secToHms(sec)
}
