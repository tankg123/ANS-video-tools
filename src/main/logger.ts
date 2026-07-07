import fs from 'node:fs'
import path from 'node:path'
import { logsDir } from './env'

const RING_MAX = 500
const PRUNE_DAYS = 7

export interface TaskLog {
  file: string
  write(line: string): void
  close(): void
}

class Logger {
  /** ring buffer RAM 500 dòng/task đang chạy — đọc nhanh không chạm đĩa */
  private rings = new Map<string, string[]>()
  private streams = new Map<string, fs.WriteStream>()

  create(taskId: string): TaskLog {
    const file = path.join(logsDir, `${taskId}.log`)
    let stream: fs.WriteStream | null = null
    try {
      stream = fs.createWriteStream(file, { flags: 'a' })
      this.streams.set(taskId, stream)
    } catch {
      /* log ra file lỗi thì vẫn giữ ring buffer */
    }
    const ring: string[] = []
    this.rings.set(taskId, ring)
    return {
      file,
      write: (line: string): void => {
        ring.push(line)
        if (ring.length > RING_MAX) ring.splice(0, ring.length - RING_MAX)
        stream?.write(line + '\n')
      },
      close: (): void => {
        stream?.end()
        this.streams.delete(taskId)
        // giữ ring buffer thêm để user xem log sau khi xong; sẽ bị GC khi app restart
      }
    }
  }

  /** Đọc log: ưu tiên ring buffer, fallback đọc đuôi file. */
  read(taskId: string, tail = RING_MAX): string[] {
    const ring = this.rings.get(taskId)
    if (ring && ring.length) return ring.slice(-tail)
    const file = path.join(logsDir, `${taskId}.log`)
    try {
      const st = fs.statSync(file)
      const size = Math.min(st.size, 256 * 1024)
      const fd = fs.openSync(file, 'r')
      const buf = Buffer.alloc(size)
      fs.readSync(fd, buf, 0, size, st.size - size)
      fs.closeSync(fd)
      return buf.toString('utf8').split(/\r?\n/).slice(-tail)
    } catch {
      return []
    }
  }

  /** Xoá log cũ hơn 7 ngày (chạy lúc khởi động). */
  pruneOld(): void {
    const cutoff = Date.now() - PRUNE_DAYS * 24 * 3600 * 1000
    try {
      for (const f of fs.readdirSync(logsDir)) {
        if (!f.endsWith('.log')) continue
        const p = path.join(logsDir, f)
        try {
          if (fs.statSync(p).mtimeMs < cutoff) fs.unlinkSync(p)
        } catch {
          /* ignore */
        }
      }
    } catch {
      /* ignore */
    }
  }
}

export const logger = new Logger()
