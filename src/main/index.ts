import { app, BrowserWindow, Menu } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
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

let mainWindow: BrowserWindow | null = null
const isSmoke = process.env.VT_SMOKE === '1'

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1360,
    height: 850,
    minWidth: 1080,
    minHeight: 700,
    show: false,
    backgroundColor: '#0d1220',
    title: 'Video Toolkit AIO Pro',
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
    settings.load()
    logger.pruneOld()
    // dọn ffmpeg mồ côi từ phiên trước (spec mục 2)
    pm.orphanCleanup().catch(() => {})

    const s = settings.all()
    queue.applySettingsLimits(s.maxFfmpeg, s.maxDownloads, s.maxLive)

    const ctx = createModuleContext()
    registerCoreIpc(ctx, () => mainWindow)
    registerAllModules(ctx)

    createWindow()
    startSystemStats()

    // dò encoder phần cứng nền, không chặn khởi động (spec 5.1)
    detectHardware().catch(() => {})

    if (isSmoke) {
      setTimeout(async () => {
        try {
          const img = await mainWindow!.webContents.capturePage()
          const dir = path.join(app.getAppPath(), '.smoke')
          fs.mkdirSync(dir, { recursive: true })
          fs.writeFileSync(path.join(dir, 'screenshot.png'), img.toPNG())
          console.log('SMOKE_OK')
        } catch (e) {
          console.error('SMOKE_FAIL', e)
        } finally {
          app.exit(0)
        }
      }, 4000)
    }
  })
}

app.on('before-quit', () => {
  // không để lại process mồ côi khi thoát app
  pm.killAllTracked()
  settings.flushNow()
})

app.on('window-all-closed', () => {
  app.quit()
})
