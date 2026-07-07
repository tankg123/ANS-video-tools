/// <reference types="vite/client" />

interface Window {
  vt: {
    invoke<T = unknown>(channel: string, payload?: unknown): Promise<T>
    on(channel: string, cb: (data: unknown) => void): () => void
    pathForFile(file: File): string
  }
}
