import { DEFAULT_ACCENT_COLOR, normalizeAccentColor } from '@shared/theme'

function hexToRgb(color: string): { r: number; g: number; b: number } {
  return {
    r: Number.parseInt(color.slice(1, 3), 16),
    g: Number.parseInt(color.slice(3, 5), 16),
    b: Number.parseInt(color.slice(5, 7), 16)
  }
}

/** Áp dụng màu nhấn và các biến dẫn xuất cho toàn bộ renderer. */
export function applyAccentColor(value: unknown): string {
  const color = normalizeAccentColor(value ?? DEFAULT_ACCENT_COLOR)
  const { r, g, b } = hexToRgb(color)
  const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
  const root = document.documentElement
  root.style.setProperty('--accent', color)
  root.style.setProperty('--accent-rgb', `${r}, ${g}, ${b}`)
  root.style.setProperty('--accent-contrast', luminance > 0.58 ? '#07110B' : '#F8FAFC')
  return color
}
