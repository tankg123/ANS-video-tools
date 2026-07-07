import { create } from 'zustand'
import { useShallow } from 'zustand/react/shallow'
import type { TaskInfo } from '@shared/types'

/**
 * Store task trung tâm — nhận batch update từ main (throttle 4Hz).
 * Row UI subscribe theo id (spec 5.4 — tránh re-render toàn bảng).
 */
interface TasksState {
  byId: Record<string, TaskInfo>
  order: string[]
  upsert(list: TaskInfo[]): void
  remove(ids: string[]): void
  hydrate(list: TaskInfo[]): void
}

export const useTasks = create<TasksState>((set, get) => ({
  byId: {},
  order: [],
  upsert: (list) => {
    const byId = { ...get().byId }
    let order = get().order
    const newIds: string[] = []
    for (const t of list) {
      if (!byId[t.id]) newIds.push(t.id)
      byId[t.id] = t
    }
    if (newIds.length) order = [...order, ...newIds]
    set({ byId, order })
  },
  remove: (ids) => {
    const byId = { ...get().byId }
    for (const id of ids) delete byId[id]
    set({ byId, order: get().order.filter((id) => !ids.includes(id)) })
  },
  hydrate: (list) =>
    set({
      byId: Object.fromEntries(list.map((t) => [t.id, t])),
      order: list.map((t) => t.id)
    })
}))

/** ids các task thuộc các type chỉ định, mới nhất trước. */
export function useTaskIdsByTypes(types: string[]): string[] {
  return useTasks(
    useShallow((s) =>
      s.order
        .filter((id) => {
          const t = s.byId[id]
          return t && types.includes(t.type)
        })
        .reverse()
    )
  )
}

export function useTask(id: string): TaskInfo | undefined {
  return useTasks((s) => s.byId[id])
}
