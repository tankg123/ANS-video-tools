import { app, BrowserWindow, Menu } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import appIcon from '../../resources/icon.png?asset'
import { registerCoreIpc } from './core-ipc'
import { ensureDirs } from './env'
import { detectHardware } from './hardware'
import { logger } from './logger'
import { createModuleContext } from './module-context'
import { registerAllModules } from './modules'
import { pm } from './process-manager'
import { settings } from './settings-store'
import { startSystemStats } from './system-stats'
import { queue } from './task-queue'
import { sweepStaleTempFiles } from './util'

let mainWindow: BrowserWindow | null = null
const isSmoke = process.env.VT_SMOKE === '1'

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1360,
    height: 850,
    minWidth: 1080,
    minHeight: 700,
    show: false,
    backgroundColor: '#07090e',
    title: 'ANS Video Tools',
    icon: appIcon,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: false
    }
  })

  mainWindow.on('ready-to-show', () => mainWindow?.show())

  if (isSmoke) {
    mainWindow.webContents.on('console-message', (_e, level, message) => {
      if (level >= 2) console.log(`[renderer:${level}] ${message}`)
    })
  }

  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))
  }
}

// một instance duy nhất
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })

  app.whenReady().then(async () => {
    Menu.setApplicationMenu(null)
    ensureDirs()
    sweepStaleTempFiles()
    settings.load()
    logger.pruneOld()
    // dọn ffmpeg mồ côi từ phiên trước (spec mục 2)
    pm.orphanCleanup().catch(() => {})

    const s = settings.all()
    queue.applySettingsLimits(s.maxFfmpeg, s.maxDownloads)

    const ctx = createModuleContext()
    registerCoreIpc(ctx, () => mainWindow)
    registerAllModules(ctx)

    createWindow()
    startSystemStats()

    // dò encoder phần cứng nền, không chặn khởi động (spec 5.1)
    detectHardware().catch(() => {})

    if (isSmoke) {
      setTimeout(async () => {
        let previousModule: string | null = null
        try {
          const smokeModule = process.env.VT_SMOKE_MODULE
          if (smokeModule) {
            previousModule = await mainWindow!.webContents.executeJavaScript(`(() => {
              const previous = localStorage.getItem('vt.activeModule')
              const target = ${JSON.stringify(smokeModule)}
              const button = Array.from(document.querySelectorAll('[data-module-key]'))
                .find((element) => element.getAttribute('data-module-key') === target)
              if (button instanceof HTMLElement) button.click()
              return previous
            })()`)
            await new Promise<void>((resolve) => setTimeout(resolve, 600))
          }
          if (process.env.VT_SMOKE_SETTINGS === '1') {
            await mainWindow!.webContents.executeJavaScript(`(() => {
              const button = document.querySelector('.settings-trigger')
              if (button instanceof HTMLElement) button.click()
            })()`)
            await new Promise<void>((resolve) => setTimeout(resolve, 400))
          }
          if (process.env.VT_SMOKE_ACCENT_TEST === '1') {
            const accentResult = await mainWindow!.webContents.executeJavaScript(`(async () => {
              const original = await window.vt.invoke('core:settings:get')
              const testColor = '#93C5FD'
              await window.vt.invoke('core:settings:set', { accentColor: testColor })
              await new Promise((resolve) => setTimeout(resolve, 120))
              const applied = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim().toUpperCase()
              const stored = (await window.vt.invoke('core:settings:get')).accentColor
              await window.vt.invoke('core:settings:set', { accentColor: original.accentColor })
              await new Promise((resolve) => setTimeout(resolve, 120))
              const restored = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim().toUpperCase()
              return { applied, stored, restored, expectedRestore: original.accentColor }
            })()`)
            if (
              accentResult.applied !== '#93C5FD' ||
              accentResult.stored !== '#93C5FD' ||
              accentResult.restored !== accentResult.expectedRestore
            ) {
              throw new Error(`Accent smoke failed: ${JSON.stringify(accentResult)}`)
            }
            console.log('ACCENT_OK')
          }
          await mainWindow!.webContents.executeJavaScript('window.scrollTo(0, 0); document.body.offsetHeight')
          mainWindow!.webContents.invalidate()
          await new Promise<void>((resolve) => setTimeout(resolve, 300))
          // Chromium đôi lúc chỉ trả vùng damage ở lần capture đầu; warm-up rồi ép full repaint.
          await mainWindow!.webContents.capturePage()
          mainWindow!.webContents.invalidate()
          await new Promise<void>((resolve) => setTimeout(resolve, 250))
          const img = await mainWindow!.webContents.capturePage()
          const dir = path.join(app.getAppPath(), '.smoke')
          fs.mkdirSync(dir, { recursive: true })
          fs.writeFileSync(path.join(dir, 'screenshot.png'), img.toPNG())
          console.log('SMOKE_OK')
        } catch (e) {
          console.error('SMOKE_FAIL', e)
        } finally {
          if (process.env.VT_SMOKE_MODULE) {
            const previousJson = JSON.stringify(previousModule)
            await mainWindow!.webContents.executeJavaScript(`(() => {
              const previous = ${previousJson}
              if (previous === null) localStorage.removeItem('vt.activeModule')
              else localStorage.setItem('vt.activeModule', previous)
            })()`).catch(() => {})
          }
          app.exit(0)
        }
      }, 4000)
    }
  })
}

app.on('before-quit', () => {
  // không để lại process mồ côi khi thoát app
  pm.killAllTracked()
  pm.flushNow()
  settings.flushNow()
})

app.on('window-all-closed', () => {
  app.quit()
})
