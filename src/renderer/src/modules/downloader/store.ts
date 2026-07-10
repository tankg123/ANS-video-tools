import { create } from 'zustand'
import type { DlItem } from '@shared/modules/downloader'
import { kvGet, kvSet } from '../../api'

/**
 * Store danh sách video tải — persist qua kv namespace 'downloader' (key 'items'),
 * gửi KV ngay cho main; SettingsStore chịu trách nhiệm debounce/flush đĩa khi thoát.
 */

interface DlState {
  items: DlItem[]
  loaded: boolean
  load(): Promise<void>
  /** thêm items mới (bỏ qua id đã tồn tại) — trả về số item thêm được */
  merge(items: DlItem[]): number
  update(id: string, patch: Partial<DlItem>): void
  /** gán taskId + status 'queued' sau khi enqueue */
  markStarted(results: { itemId: string; taskId: string }[]): void
  remove(id: string): void
  clear(): void
}

function schedulePersist(items: DlItem[]): void {
  void kvSet('downloader', 'items', items)
}

export const useDl = create<DlState>((set, get) => ({
  items: [],
  loaded: false,
  load: async () => {
    if (get().loaded) return
    const raw = await kvGet<DlItem[]>('downloader', 'items', [])
    // sau khi restart app, queue rỗng — task cũ không còn → đưa về idle
    const items = (Array.isArray(raw) ? raw : []).map((it) =>
      it.status === 'queued' || it.status === 'downloading'
        ? { ...it, status: 'idle' as const, taskId: undefined }
        : it
    )
    set({ items, loaded: true })
  },
  merge: (incoming) => {
    const existing = new Set(get().items.map((it) => it.id))
    const fresh = incoming.filter((it) => !existing.has(it.id))
    if (fresh.length) {
      const items = [...get().items, ...fresh]
      set({ items })
      schedulePersist(items)
    }
    return fresh.length
  },
  update: (id, patch) => {
    const items = get().items.map((it) => (it.id === id ? { ...it, ...patch } : it))
    set({ items })
    schedulePersist(items)
  },
  markStarted: (results) => {
    const byItem = new Map(results.map((r) => [r.itemId, r.taskId]))
    const items = get().items.map((it) =>
      byItem.has(it.id)
        ? { ...it, taskId: byItem.get(it.id), status: 'queued' as const, error: undefined }
        : it
    )
    set({ items })
    schedulePersist(items)
  },
  remove: (id) => {
    const items = get().items.filter((it) => it.id !== id)
    set({ items })
    schedulePersist(items)
  },
  clear: () => {
    set({ items: [] })
    schedulePersist([])
  }
}))
