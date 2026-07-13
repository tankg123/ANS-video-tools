import { create } from 'zustand'
import type { AuthStatus, AuthUpdateReason } from '@shared/types'
import * as api from '../api'

interface AuthState {
  status: AuthStatus | null
  checking: boolean
  error: string | null
  reason: AuthUpdateReason | null
  init(): Promise<void>
  login(username: string, password: string): Promise<AuthStatus>
  logout(): Promise<void>
  apply(status: AuthStatus, reason?: AuthUpdateReason): void
}

export const useAuth = create<AuthState>((set) => ({
  status: null,
  checking: true,
  error: null,
  reason: null,

  init: async () => {
    set({ checking: true, error: null })
    try {
      const status = await api.getAuthStatus()
      set({ status, checking: false, reason: null })
    } catch (error) {
      set({
        status: null,
        checking: false,
        error: api.cleanError(error)
      })
    }
  },

  login: async (username, password) => {
    const status = await api.login(username, password)
    set({ status, checking: false, error: null, reason: 'login' })
    return status
  },

  logout: async () => {
    const status = await api.logout()
    set({ status, checking: false, error: null, reason: 'logout' })
  },

  apply: (status, reason) => set({ status, checking: false, error: null, reason: reason ?? null })
}))
