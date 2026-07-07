import { create } from 'zustand'
import type { AppSettings } from '@shared/types'
import * as api from '../api'

interface SettingsState {
  settings: AppSettings | null
  init(): Promise<void>
  apply(s: AppSettings): void
  update(patch: Partial<AppSettings>): Promise<void>
}

export const useSettings = create<SettingsState>((set) => ({
  settings: null,
  init: async () => {
    const s = await api.getSettings()
    set({ settings: s })
  },
  apply: (s) => set({ settings: s }),
  update: async (patch) => {
    const s = await api.setSettings(patch)
    set({ settings: s })
  }
}))

export function useLang(): 'vi' | 'en' {
  return useSettings((s) => s.settings?.language ?? 'vi')
}
