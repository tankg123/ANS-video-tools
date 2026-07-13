import { app, BrowserWindow, Menu } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import appIcon from '../../resources/icon.png?asset'
import { authSession } from './auth-session'
import { registerCoreIpc } from './core-ipc'
import { ensureDirs } from './env'
import { logger } from './logger'
import { createModuleContext, isProtectedIpcChannel } from './module-context'
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
    const modules = registerAllModules(ctx)
    registerCoreIpc(ctx, () => mainWindow, modules.updater.runStartup)

    // Bắt đầu kiểm tra ngay trong main process, trước khi tạo UI và trước mọi lần xác thực.
    void modules.updater.runStartup()

    createWindow()
    startSystemStats()

    if (isSmoke) {
      setTimeout(async () => {
        let previousModule: string | null = null
        let smokeFailed = false
        try {
          const expectRememberedLogin = process.env.VT_SMOKE_AUTH_EXPECT_REMEMBERED === '1'
          const startupUpdate = await mainWindow!.webContents.executeJavaScript(
            "window.vt.invoke('mod:updater:startup')"
          )
          const startupUpdateStateOk = app.isPackaged
            ? startupUpdate?.state?.supported === true &&
              startupUpdate?.state?.phase === 'up-to-date'
            : startupUpdate?.state?.supported === false &&
              startupUpdate?.state?.phase === 'disabled'
          const startupUpdateGateOk =
            startupUpdate?.readyForLogin === true &&
            startupUpdateStateOk &&
            !isProtectedIpcChannel('mod:updater:startup') &&
            isProtectedIpcChannel('mod:updater:state')
          if (!startupUpdateGateOk) throw new Error('Startup updater gate smoke failed')
          console.log('STARTUP_UPDATE_GATE_OK')
          let protectedAccessDenied = false
          try {
            authSession.assertAuthenticated()
          } catch {
            protectedAccessDenied = true
          }
          const loginVisible = await mainWindow!.webContents.executeJavaScript(
            "document.querySelector('.login-card') instanceof HTMLElement"
          )
          const loginDeviceIdHidden = await mainWindow!.webContents.executeJavaScript(`(() => {
            const card = document.querySelector('.login-card')
            if (!(card instanceof HTMLElement)) return false
            const text = card.textContent ?? ''
            return !card.querySelector('.login-device') &&
              !card.querySelector('code') &&
              !text.includes('Mã thiết bị (HWID)') &&
              !text.includes('Device ID (HWID)')
          })()`)
          const protectedChannelsRegistered =
            isProtectedIpcChannel('core:tasks:list') &&
            isProtectedIpcChannel('mod:render:start')
          if (expectRememberedLogin) {
            const rememberedUiVisible = await mainWindow!.webContents.executeJavaScript(
              "document.querySelector('.app-shell') instanceof HTMLElement"
            )
            if (
              loginVisible ||
              protectedAccessDenied ||
              !rememberedUiVisible ||
              !protectedChannelsRegistered
            ) {
              throw new Error('Remembered authentication smoke failed')
            }
            console.log('AUTH_REMEMBERED_OK')
          } else {
            if (
              !loginVisible ||
              !loginDeviceIdHidden ||
              !protectedAccessDenied ||
              !protectedChannelsRegistered
            ) {
              throw new Error('Authentication gate smoke failed')
            }
            console.log('AUTH_GATE_OK')
          }

          const smokeUsername = process.env.VT_SMOKE_AUTH_USERNAME
          const smokePassword = process.env.VT_SMOKE_AUTH_PASSWORD
          const authenticatedUiRequested = !!(
            process.env.VT_SMOKE_MODULE ||
            process.env.VT_SMOKE_SETTINGS === '1' ||
            process.env.VT_SMOKE_ACCENT_TEST === '1'
          )
          if ((smokeUsername && !smokePassword) || (!smokeUsername && smokePassword)) {
            throw new Error('Smoke authentication requires both username and password')
          }
          if (authenticatedUiRequested && !expectRememberedLogin && (!smokeUsername || !smokePassword)) {
            throw new Error('Authenticated smoke options require VT_SMOKE_AUTH_USERNAME/PASSWORD')
          }
          if (smokeUsername && smokePassword) {
            const loginResult = await mainWindow!.webContents.executeJavaScript(`window.vt.invoke(
              'core:auth:login',
              ${JSON.stringify({ username: smokeUsername, password: smokePassword })}
            )`)
            if (!loginResult?.authenticated || !loginResult?.account?.expiresAt) {
              throw new Error('Authentication login smoke failed')
            }
            await new Promise<void>((resolve) => setTimeout(resolve, 350))
            const authenticatedUiOk = await mainWindow!.webContents.executeJavaScript(`(() => {
              const expiry = document.querySelector('.user-copy small')?.textContent ?? ''
              return document.querySelector('.app-shell') instanceof HTMLElement && expiry.length > 5 && !expiry.endsWith('—')
            })()`)
            if (!authenticatedUiOk) throw new Error('Authenticated UI smoke failed')
            console.log('AUTH_LOGIN_OK')

            if (process.env.VT_SMOKE_AUTH_EXPECT_EXPIRY === '1') {
              await new Promise<void>((resolve) => setTimeout(resolve, 2_500))
              let expiredAccessDenied = false
              try {
                authSession.assertAuthenticated()
              } catch {
                expiredAccessDenied = true
              }
              const expiredUiOk = await mainWindow!.webContents.executeJavaScript(
                "document.querySelector('.login-card') instanceof HTMLElement && !document.querySelector('.app-shell')"
              )
              if (!expiredUiOk || !expiredAccessDenied) throw new Error('Authentication expiry smoke failed')
              console.log('AUTH_EXPIRY_OK')
            }
          }

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
          smokeFailed = true
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
          app.exit(smokeFailed ? 1 : 0)
        }
      }, 4000)
    }
  })
}

app.on('before-quit', () => {
  // không để lại process mồ côi khi thoát app
  authSession.dispose()
  pm.killAllTracked()
  pm.flushNow()
  settings.flushNow()
})

app.on('window-all-closed', () => {
  app.quit()
})
