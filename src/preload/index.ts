import { contextBridge, ipcRenderer, webUtils } from 'electron'

const INVOKE_OK = /^(core|mod):/
const EVENT_OK = /^(task:|stats:|settings:|auth:|toast$|mod:)/

export interface VtApi {
  invoke<T = unknown>(channel: string, payload?: unknown): Promise<T>
  on(channel: string, cb: (data: unknown) => void): () => void
  pathForFile(file: File): string
}

const api: VtApi = {
  invoke: (channel, payload) => {
    if (!INVOKE_OK.test(channel)) {
      return Promise.reject(new Error(`Channel bị chặn: ${channel}`))
    }
    return ipcRenderer.invoke(channel, payload)
  },
  on: (channel, cb) => {
    if (!EVENT_OK.test(channel)) throw new Error(`Event channel bị chặn: ${channel}`)
    const listener = (_e: Electron.IpcRendererEvent, data: unknown): void => cb(data)
    ipcRenderer.on(channel, listener)
    return () => ipcRenderer.removeListener(channel, listener)
  },
  // Electron mới bỏ File.path — phải dùng webUtils (kéo-thả file)
  pathForFile: (file) => webUtils.getPathForFile(file)
}

contextBridge.exposeInMainWorld('vt', api)
