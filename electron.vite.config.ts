import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: { '@shared': resolve(__dirname, 'src/shared') }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()]
  },
  renderer: {
    plugins: [react()],
    build: {
      rollupOptions: {
        output: {
          manualChunks(id): string | undefined {
            const moduleId = id.replace(/\\/g, '/')
            if (moduleId.includes('/node_modules/react/') || moduleId.includes('/node_modules/react-dom/')) {
              return 'vendor-react'
            }
            if (moduleId.includes('/node_modules/zustand/')) return 'vendor-state'
            if (moduleId.includes('/node_modules/@tanstack/')) return 'vendor-virtual'
            return undefined
          }
        }
      }
    },
    resolve: {
      alias: {
        '@shared': resolve(__dirname, 'src/shared'),
        '@renderer': resolve(__dirname, 'src/renderer/src')
      }
    }
  }
})
