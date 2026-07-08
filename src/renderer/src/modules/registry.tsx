import { lazy, ComponentType, LazyExoticComponent } from 'react'
import type { ModuleKey } from '../store/ui'

export interface ModuleDef {
  key: ModuleKey
  vi: string
  en: string
  icon: string
  Component: LazyExoticComponent<ComponentType>
}

/**
 * Registry 11 module (spec 3.1). Lazy-load: chỉ mount UI tab đang mở (spec 5.6).
 * Thứ tự = thứ tự sidebar; 'updater' luôn ghim dưới cùng.
 */
export const MODULES: ModuleDef[] = [
  {
    key: 'super-live',
    vi: 'Super Live Stream',
    en: 'Super Live Stream',
    icon: '📡',
    Component: lazy(() => import('./super-live/SuperLive'))
  },
  {
    key: 'basic-live',
    vi: 'Basic Live Stream',
    en: 'Basic Live Stream',
    icon: '🎥',
    Component: lazy(() => import('./basic-live/BasicLive'))
  },
  {
    key: 'render',
    vi: 'Render H264/H265',
    en: 'Render H264/H265',
    icon: '🎞️',
    Component: lazy(() => import('./render/Render'))
  },
  {
    key: 'upscale',
    vi: 'Nâng cấp 4K (AI)',
    en: 'AI Upscale 4K',
    icon: '✨',
    Component: lazy(() => import('./upscale/Upscale'))
  },
  {
    key: 'intro-outro-logo',
    vi: 'Chèn Intro / Outro / Logo',
    en: 'Intro / Outro / Logo',
    icon: '🏷️',
    Component: lazy(() => import('./intro-outro-logo/IntroOutroLogo'))
  },
  {
    key: 'split',
    vi: 'Cắt chia nhỏ Video',
    en: 'Split Video',
    icon: '✂️',
    Component: lazy(() => import('./split/Split'))
  },
  {
    key: 'trim',
    vi: 'Cắt ngắn Video',
    en: 'Trim Video',
    icon: '✄',
    Component: lazy(() => import('./trim/Trim'))
  },
  {
    key: 'green-screen',
    vi: 'Chèn Phông Xanh',
    en: 'Green Screen',
    icon: '🟩',
    Component: lazy(() => import('./green-screen/GreenScreen'))
  },
  {
    key: 'loop',
    vi: 'Lặp lại Video',
    en: 'Loop Video',
    icon: '🔁',
    Component: lazy(() => import('./loop/Loop'))
  },
  {
    key: 'concat',
    vi: 'Ghép nối Video',
    en: 'Concat Videos',
    icon: '🧩',
    Component: lazy(() => import('./concat/Concat'))
  },
  {
    key: 'downloader',
    vi: 'Tải Video',
    en: 'Download Video',
    icon: '⬇️',
    Component: lazy(() => import('./downloader/Downloader'))
  },
  {
    key: 'updater',
    vi: 'Kiểm tra cập nhật',
    en: 'Check Updates',
    icon: '🔄',
    Component: lazy(() => import('./updater/Updater'))
  }
]
