import { lazy, ComponentType, LazyExoticComponent } from 'react'
import type { IconName } from '../components/Icon'
import type { ModuleKey } from '../store/ui'

export type ModuleGroup = 'processing' | 'editing' | 'automation' | 'system'

export interface ModuleDef {
  key: ModuleKey
  vi: string
  en: string
  icon: IconName
  group: ModuleGroup
  Component: LazyExoticComponent<ComponentType>
}

/**
 * Registry 14 module. Lazy-load: chỉ mount UI tab đang mở.
 * Thứ tự = thứ tự sidebar; 'updater' luôn ghim dưới cùng.
 */
export const MODULES: ModuleDef[] = [
  {
    key: 'render',
    vi: 'Render H264/H265',
    en: 'Render H264/H265',
    icon: 'render',
    group: 'processing',
    Component: lazy(() => import('./render/Render'))
  },
  {
    key: 'remove-audio',
    vi: 'X\u00f3a Audio kh\u1ecfi Video',
    en: 'Remove Audio',
    icon: 'volume-off',
    group: 'processing',
    Component: lazy(() => import('./remove-audio/RemoveAudio'))
  },
  {
    key: 'upscale',
    vi: 'Nâng cấp 4K (AI)',
    en: 'AI Upscale 4K',
    icon: 'sparkles',
    group: 'processing',
    Component: lazy(() => import('./upscale/Upscale'))
  },
  {
    key: 'intro-outro-logo',
    vi: 'Chèn Intro / Outro / Logo',
    en: 'Intro / Outro / Logo',
    icon: 'layers',
    group: 'processing',
    Component: lazy(() => import('./intro-outro-logo/IntroOutroLogo'))
  },
  {
    key: 'split',
    vi: 'Cắt chia nhỏ Video',
    en: 'Split Video',
    icon: 'scissors',
    group: 'editing',
    Component: lazy(() => import('./split/Split'))
  },
  {
    key: 'trim',
    vi: 'Cắt ngắn Video',
    en: 'Trim Video',
    icon: 'trim',
    group: 'editing',
    Component: lazy(() => import('./trim/Trim'))
  },
  {
    key: 'green-screen',
    vi: 'Chèn Phông Xanh',
    en: 'Green Screen',
    icon: 'green-screen',
    group: 'processing',
    Component: lazy(() => import('./green-screen/GreenScreen'))
  },
  {
    key: 'photokey',
    vi: 'Xóa Nền Ảnh',
    en: 'Photo Background Removal',
    icon: 'sparkles',
    group: 'processing',
    Component: lazy(() => import('./photokey/Photokey'))
  },
  {
    key: 'loop',
    vi: 'Lặp lại Video',
    en: 'Loop Video',
    icon: 'repeat',
    group: 'editing',
    Component: lazy(() => import('./loop/Loop'))
  },
  {
    key: 'concat',
    vi: 'Ghép nối Video',
    en: 'Concat Videos',
    icon: 'merge',
    group: 'editing',
    Component: lazy(() => import('./concat/Concat'))
  },
  {
    key: 'random',
    vi: 'Ghép Video Ngẫu Nhiên',
    en: 'Random Merge',
    icon: 'shuffle',
    group: 'automation',
    Component: lazy(() => import('./random/Random'))
  },
  {
    key: 'random-audio',
    vi: 'Ghép Âm Thanh Ngẫu Nhiên',
    en: 'Random Audio Merge',
    icon: 'audio',
    group: 'automation',
    Component: lazy(() => import('./random-audio/RandomAudio'))
  },
  {
    key: 'downloader',
    vi: 'Tải Video',
    en: 'Download Video',
    icon: 'download',
    group: 'automation',
    Component: lazy(() => import('./downloader/Downloader'))
  },
  {
    key: 'updater',
    vi: 'Kiểm tra cập nhật',
    en: 'Check Updates',
    icon: 'refresh',
    group: 'system',
    Component: lazy(() => import('./updater/Updater'))
  }
]
