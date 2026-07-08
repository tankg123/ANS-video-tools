import { create } from 'zustand'
import type { SystemStats, ToastMsg } from '@shared/types'

export type ModuleKey =
  | 'super-live'
  | 'basic-live'
  | 'render'
  | 'upscale'
  | 'intro-outro-logo'
  | 'split'
  | 'trim'
  | 'green-screen'
  | 'loop'
  | 'concat'
  | 'downloader'
  | 'updater'

interface Toast extends ToastMsg {
  id: number
}

interface UiState {
  active: ModuleKey
  setActive(k: ModuleKey): void
  stats: SystemStats | null
  setStats(s: SystemStats): void
  toasts: Toast[]
  pushToast(type: ToastMsg['type'], message: string): void
  dismissToast(id: number): void
  settingsOpen: boolean
  setSettingsOpen(open: boolean): void
}

let toastSeq = 1

export const useUi = create<UiState>((set, get) => ({
  active: (localStorage.getItem('vt.activeModule') as ModuleKey) || 'downloader',
  setActive: (k) => {
    localStorage.setItem('vt.activeModule', k)
    set({ active: k })
  },
  stats: null,
  setStats: (stats) => set({ stats }),
  toasts: [],
  pushToast: (type, message) => {
    const id = toastSeq++
    set({ toasts: [...get().toasts, { id, type, message }] })
    setTimeout(() => get().dismissToast(id), type === 'error' ? 6000 : 3500)
  },
  dismissToast: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),
  settingsOpen: false,
  setSettingsOpen: (settingsOpen) => set({ settingsOpen })
}))
