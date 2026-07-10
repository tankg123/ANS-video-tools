export const DEFAULT_ACCENT_COLOR = '#86EFAC'

export interface AccentPreset {
  value: string
  vi: string
  en: string
}

export const ACCENT_PRESETS: AccentPreset[] = [
  { value: DEFAULT_ACCENT_COLOR, vi: 'Xanh lá nhạt', en: 'Soft green' },
  { value: '#67E8F9', vi: 'Xanh ngọc', en: 'Cyan' },
  { value: '#93C5FD', vi: 'Xanh trời', en: 'Sky blue' },
  { value: '#C4B5FD', vi: 'Tím nhạt', en: 'Soft violet' },
  { value: '#F9A8D4', vi: 'Hồng nhạt', en: 'Soft pink' },
  { value: '#FCD34D', vi: 'Hổ phách', en: 'Amber' }
]

export function normalizeAccentColor(value: unknown): string {
  if (typeof value !== 'string') return DEFAULT_ACCENT_COLOR
  const normalized = value.trim().toUpperCase()
  return /^#[0-9A-F]{6}$/.test(normalized) ? normalized : DEFAULT_ACCENT_COLOR
}
