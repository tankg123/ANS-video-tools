import { BrowserWindow } from 'electron'
import { randomUUID } from 'node:crypto'
import os from 'node:os'
import type { TaskInfo, TaskPool, TaskStatus } from '@shared/types'
import { EV_TASK_REMOVED, EV_TASK_UPDATE } from '@shared/types'

export interface TaskApi {
  id: string
  update(patch: Partial<TaskInfo>): void
  /** đăng ký hàm huỷ (thường là kill process) — gọi khi user bấm dừng */
  setCancelHook(fn: () => void): void
  isCancelled(): boolean
}

export interface AddTaskOptions {
  type: string
  title: string
  pool?: TaskPool
  meta?: Record<string, unknown>
  run(api: TaskApi): Promise<void>
}

interface Rec {
  info: TaskInfo
  run: (api: TaskApi) => Promise<void>
  cancelled: boolean
  cancelHook?: () => void
}

const FLUSH_MS = 250 // throttle cập nhật UI tối đa 4 lần/giây (spec 5.3)

/**
 * Hàng đợi tác vụ trung tâm (spec mục 2):
 * - pool riêng: ffmpeg (render/cut/...), download (yt-dlp), live (stream), misc
 * - giới hạn song song từng pool, pump tự động
 * - broadcast thay đổi về renderer theo lô, throttle 4Hz
 */
export class TaskQueue {
  private recs = new Map<string, Rec>()
  private order: string[] = []
  private limits: Record<string, number> = {
    ffmpeg: Math.max(1, Math.floor(os.cpus().length / 2)),
    download: 2,
    live: 5,
    misc: 2
  }
  private running: Record<string, number> = {}
  private dirty = new Set<string>()
  private flushTimer: ReturnType<typeof setInterval> | null = null

  setLimit(pool: TaskPool, n: number): void {
    this.limits[pool] = Math.max(1, Math.floor(n) || 1)
    this.pump(pool)
  }

  /** giới hạn hiệu dụng pool ffmpeg = min(cấu hình user, số nhân CPU / 2) — spec 5.3 */
  applySettingsLimits(maxFfmpeg: number, maxDownloads: number, maxLive: number): void {
    const cpuCap = Math.max(1, Math.floor(os.cpus().length / 2))
    this.setLimit('ffmpeg', Math.min(Math.max(1, maxFfmpeg), cpuCap))
    this.setLimit('download', Math.min(Math.max(1, maxDownloads), 10))
    this.setLimit('live', Math.max(1, maxLive))
  }

  add(opts: AddTaskOptions): string {
    const id = randomUUID()
    const info: TaskInfo = {
      id,
      type: opts.type,
      title: opts.title,
      pool: opts.pool ?? 'ffmpeg',
      status: 'queued',
      progress: 0,
      createdAt: Date.now(),
      meta: opts.meta
    }
    this.recs.set(id, { info, run: opts.run, cancelled: false })
    this.order.push(id)
    this.markDirty(id)
    this.pump(info.pool)
    return id
  }

  get(id: string): TaskInfo | undefined {
    return this.recs.get(id)?.info
  }

  list(): TaskInfo[] {
    return this.order.map((id) => this.recs.get(id)!.info).filter(Boolean)
  }

  cancel(id: string): void {
    const rec = this.recs.get(id)
    if (!rec) return
    if (rec.info.status === 'queued') {
      rec.cancelled = true
      this.finish(id, 'killed')
    } else if (rec.info.status === 'running') {
      rec.cancelled = true
      try {
        rec.cancelHook?.()
      } catch {
        /* ignore */
      }
    }
  }

  /** Huỷ mọi task queued/running trong các pool chỉ định. Trả về số task bị huỷ. */
  cancelPools(pools: TaskPool[]): number {
    let n = 0
    for (const rec of this.recs.values()) {
      if (
        pools.includes(rec.info.pool) &&
        (rec.info.status === 'queued' || rec.info.status === 'running')
      ) {
        this.cancel(rec.info.id)
        n++
      }
    }
    return n
  }

  /** Xoá các task đã kết thúc khỏi danh sách. */
  clearFinished(types?: string[]): string[] {
    const removed: string[] = []
    for (const [id, rec] of this.recs) {
      const done =
        rec.info.status === 'completed' ||
        rec.info.status === 'error' ||
        rec.info.status === 'killed'
      if (done && (!types || types.includes(rec.info.type))) {
        this.recs.delete(id)
        removed.push(id)
      }
    }
    if (removed.length) {
      this.order = this.order.filter((id) => !removed.includes(id))
      this.broadcast(EV_TASK_REMOVED, removed)
    }
    return removed
  }

  patch(id: string, patch: Partial<TaskInfo>): void {
    const rec = this.recs.get(id)
    if (!rec) return
    Object.assign(rec.info, patch)
    this.markDirty(id)
  }

  // ---------------- internal ----------------

  private pump(pool: string): void {
    const limit = this.limits[pool] ?? 2
    while ((this.running[pool] ?? 0) < limit) {
      const nextId = this.order.find((id) => {
        const r = this.recs.get(id)
        return r && r.info.pool === pool && r.info.status === 'queued'
      })
      if (!nextId) break
      this.start(nextId)
    }
  }

  private start(id: string): void {
    const rec = this.recs.get(id)!
    const pool = rec.info.pool
    this.running[pool] = (this.running[pool] ?? 0) + 1
    rec.info.status = 'running'
    rec.info.startedAt = Date.now()
    this.markDirty(id)

    const api: TaskApi = {
      id,
      update: (patch) => this.patch(id, patch),
      setCancelHook: (fn) => {
        rec.cancelHook = fn
        // user đã bấm huỷ trước khi hook kịp đăng ký
        if (rec.cancelled) fn()
      },
      isCancelled: () => rec.cancelled
    }

    rec
      .run(api)
      .then(() => this.finish(id, rec.cancelled ? 'killed' : 'completed'))
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err)
        this.finish(id, rec.cancelled ? 'killed' : 'error', msg)
      })
      .finally(() => {
        this.running[pool] = Math.max(0, (this.running[pool] ?? 1) - 1)
        this.pump(pool)
      })
  }

  private finish(id: string, status: TaskStatus, error?: string): void {
    const rec = this.recs.get(id)
    if (!rec || rec.info.status === status) return
    rec.info.status = status
    rec.info.finishedAt = Date.now()
    if (status === 'completed') rec.info.progress = 100
    if (error) rec.info.error = error
    this.markDirty(id)
  }

  private markDirty(id: string): void {
    this.dirty.add(id)
    if (!this.flushTimer) {
      this.flushTimer = setInterval(() => this.flush(), FLUSH_MS)
      // flush ngay lần đầu cho phản hồi tức thì
      this.flush()
    }
  }

  private flush(): void {
    if (this.dirty.size === 0) {
      if (this.flushTimer) {
        clearInterval(this.flushTimer)
        this.flushTimer = null
      }
      return
    }
    const snapshot: TaskInfo[] = []
    for (const id of this.dirty) {
      const rec = this.recs.get(id)
      if (rec) snapshot.push({ ...rec.info })
    }
    this.dirty.clear()
    if (snapshot.length) this.broadcast(EV_TASK_UPDATE, snapshot)
  }

  private broadcast(channel: string, data: unknown): void {
    for (const w of BrowserWindow.getAllWindows()) {
      if (!w.isDestroyed()) w.webContents.send(channel, data)
    }
  }
}

export const queue = new TaskQueue()
