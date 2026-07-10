import { BrowserWindow } from 'electron'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { userDataDir } from './env'
import type { AppSettings } from '@shared/types'
import { EV_SETTINGS } from '@shared/types'

const FILE = path.join(userDataDir, 'settings.json')
const KV_FILE = path.join(userDataDir, 'kv.json')

function defaults(): AppSettings {
  return {
    language: 'vi',
    license: { username: 'User', key: '', expiry: null },
    outputDir: '',
    downloadDir: path.join(os.homedir(), 'Downloads'),
    maxFfmpeg: Math.max(1, Math.floor(os.cpus().length / 2)),
    maxDownloads: 2,
    encoderPref: 'auto',
    autoStart: false,
    updateUrl: ''
  }
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v)
}

function deepMerge<T>(base: T, patch: unknown): T {
  if (!isPlainObject(base) || !isPlainObject(patch)) return (patch as T) ?? base
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) }
  for (const [k, v] of Object.entries(patch)) {
    out[k] = isPlainObject(v) && isPlainObject(out[k]) ? deepMerge(out[k], v) : v
  }
  return out as T
}

class DebouncedJsonFile {
  private timer: ReturnType<typeof setTimeout> | null = null
  constructor(
    private file: string,
    private getData: () => unknown
  ) {}

  schedule(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => this.flush(), 1000)
  }

  flush(): void {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
    try {
      fs.writeFileSync(this.file, JSON.stringify(this.getData(), null, 2), 'utf8')
    } catch (e) {
      console.error('settings save failed:', e)
    }
  }
}

export class SettingsStore {
  private data: AppSettings = defaults()
  private kv: Record<string, Record<string, unknown>> = {}
  private saver = new DebouncedJsonFile(FILE, () => this.data)
  private kvSaver = new DebouncedJsonFile(KV_FILE, () => this.kv)

  load(): void {
    let settingsMigrated = false
    let kvMigrated = false
    try {
      if (fs.existsSync(FILE)) {
        const saved = JSON.parse(fs.readFileSync(FILE, 'utf8')) as Record<string, unknown>
        if ('maxLive' in saved) {
          delete saved.maxLive
          settingsMigrated = true
        }
        this.data = deepMerge(defaults(), saved)
      }
    } catch (e) {
      console.error('settings load failed:', e)
    }
    try {
      if (fs.existsSync(KV_FILE)) {
        this.kv = JSON.parse(fs.readFileSync(KV_FILE, 'utf8'))
        for (const legacyNs of ['super-live', 'basic-live', 'drive-live']) {
          if (legacyNs in this.kv) {
            delete this.kv[legacyNs]
            kvMigrated = true
          }
        }
      }
    } catch {
      this.kv = {}
    }
    if (settingsMigrated) this.saver.schedule()
    if (kvMigrated) this.kvSaver.schedule()
  }

  all(): AppSettings {
    return this.data
  }

  get<K extends keyof AppSettings>(key: K): AppSettings[K] {
    return this.data[key]
  }

  set(patch: Partial<AppSettings>): AppSettings {
    this.data = deepMerge(this.data, patch)
    this.saver.schedule()
    this.broadcast()
    return this.data
  }

  /** Namespace kv cho module tự lưu dữ liệu (vd danh sách download). Debounce 1s. */
  ns(prefix: string): { get<T>(key: string, def: T): T; set(key: string, value: unknown): void } {
    return {
      get: <T>(key: string, def: T): T => {
        const v = this.kv[prefix]?.[key]
        return (v === undefined ? def : v) as T
      },
      set: (key: string, value: unknown): void => {
        if (!this.kv[prefix]) this.kv[prefix] = {}
        this.kv[prefix][key] = value
        this.kvSaver.schedule()
      }
    }
  }

  flushNow(): void {
    this.saver.flush()
    this.kvSaver.flush()
  }

  private broadcast(): void {
    for (const w of BrowserWindow.getAllWindows()) {
      w.webContents.send(EV_SETTINGS, this.data)
    }
  }
}

export const settings = new SettingsStore()
