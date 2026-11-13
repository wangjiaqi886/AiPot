import { readFileSync } from 'node:fs'
import path from 'node:path'
import { app, BrowserWindow, Menu, protocol } from 'electron'
import log from 'electron-log/main'
import { APP_USER_MODEL_ID } from './modules/appIdentity'
import { RENDERER_SCHEME } from './modules/rendererProtocol'
import { AUTO_START_PREVIEW_MS, isAutoStartLaunch } from './modules/autoStart'
import { migrateLegacyProfile } from './modules/profileMigration'
import { isLogLevel, toLogTransportLevel, type AppLogLevel } from '../shared/logLevel'

// Keep the profile directory stable and independent of the executable name.
// `app.getPath('userData')` below resolves to `%APPDATA%\AiPot`.
app.setName('AiPot')

log.initialize()

const defaultLogLevel: AppLogLevel = app.isPackaged ? 'info' : 'debug'
log.transports.file.level = defaultLogLevel
log.transports.console.level = defaultLogLevel

if (process.platform === 'win32') {
  app.setAppUserModelId(APP_USER_MODEL_ID)
}

// Read the preference synchronously: `disableHardwareAcceleration()` must run
// before the app is ready, and the config module itself is imported later.
function readHardwareAccelerationPreference(): boolean {
  const candidates = [
    path.join(app.getPath('userData'), 'config.json'),
    path.join(app.getPath('appData'), 'NeoPot', 'config.json'),
  ]

  for (const candidate of candidates) {
    try {
      const parsed: unknown = JSON.parse(readFileSync(candidate, 'utf8'))
      if (
        parsed &&
        typeof parsed === 'object' &&
        !Array.isArray(parsed) &&
        typeof (parsed as Record<string, unknown>).hardware_acceleration === 'boolean'
      ) {
        return (parsed as Record<string, boolean>).hardware_acceleration
      }
    } catch {
      // Missing/invalid config: use the default (software rendering).
    }
  }

  return false
}

const useHardwareAcceleration = readHardwareAccelerationPreference()
if (!useHardwareAcceleration) {
  // Electron's GPU process is frequently the largest idle memory consumer
  // (100-200 MB on Windows with real hardware). AiPot is a text/OCR tool,
  // so software compositing is a good default; advanced users can opt back
  // in with `"hardware_acceleration": true` in config.json.
  app.disableHardwareAcceleration()
  app.commandLine.appendSwitch('disable-gpu')
  app.commandLine.appendSwitch('disable-gpu-compositing')
  if (!app.isPackaged) {
    app.commandLine.appendSwitch('disable-gpu-sandbox')
    app.commandLine.appendSwitch('in-process-gpu')
  }
}

if (!app.isPackaged) {
  app.commandLine.appendSwitch('no-sandbox')
}

// Register the renderer scheme before the app is ready so packaged windows
// can load over `aipot://` (a non-`file:` origin) instead of `file:`.
protocol.registerSchemesAsPrivileged([
  {
    scheme: RENDERER_SCHEME,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
    },
  },
])

const gotSingleInstanceLock = app.requestSingleInstanceLock()

if (!gotSingleInstanceLock) {
  app.quit()
} else {
  void startApp()
}

async function startApp(): Promise<void> {
  const startedFromAutoStart = isAutoStartLaunch()

  // Must run before `./modules/config` is imported: electron-store resolves
  // its file inside the (new) AiPot userData directory at import time.
  await migrateLegacyProfile()

  const config = await import('./modules/config')
  const [clipboard, hotkey, ipc, proxy, server, tray, windowModule] = await Promise.all([
    import('./modules/clipboard'),
    import('./modules/hotkey'),
    import('./modules/ipc'),
    import('./modules/proxy'),
    import('./modules/server'),
    import('./modules/tray'),
    import('./modules/window'),
  ])

  ipc.registerIpcHandlers({
    getWindowLabel: (event) => windowModule.getCurrentWindowLabel(event.sender),
  })
  proxy.registerProxyAuthentication()

  app.on('second-instance', () => {
    const [window] = BrowserWindow.getAllWindows()
    if (window) {
      if (window.isMinimized()) {
        window.restore()
      }
      window.show()
      window.focus()
      return
    }

    void windowModule.openWindow('config')
  })

  app.whenReady().then(async () => {
    Menu.setApplicationMenu(null)
    windowModule.registerRendererProtocol()
    await config.initializeConfig()

    const persistedLevel = config.getConfig('log_level')
    if (isLogLevel(persistedLevel)) {
      const transportLevel = toLogTransportLevel(persistedLevel)
      log.transports.file.level = transportLevel
      log.transports.console.level = transportLevel
    } else {
      await config.setConfig('log_level', defaultLogLevel)
    }

    try {
      ipc.migrateAutoStartLoginItem()
    } catch (error) {
      log.warn('Failed to migrate the auto-start login item.', error)
    }

    const configWindowReady = windowModule.openWindow('config', {
      autoHideAfterReadyMs: startedFromAutoStart ? AUTO_START_PREVIEW_MS : undefined,
    })
    // Only touch the session proxy when the user configured one. Calling
    // setProxy unconditionally spawns an extra proxy-resolver utility process
    // (~14 MB) and forces "direct" even when the user relies on the system
    // proxy. When the in-app proxy is off, the session keeps using the system
    // proxy settings.
    const proxyReady =
      config.getConfig('proxy_enable') === true ? proxy.applyProxyToSession() : Promise.resolve()

    tray.setupTray()
    hotkey.registerGlobalShortcuts()
    clipboard.setClipboardMonitorEnabled(config.getConfig('clipboard_monitor') === true)

    // Pre-create the hidden standby translate window so the selection
    // hotkey responds with a warm window (zero cold-start). Runs after
    // tray/hotkey so the first user-visible action never waits on it.
    windowModule.precreateTranslateWindow()

    const configuredServerPort = config.getConfig('server_port')
    const serverPort =
      typeof configuredServerPort === 'number' &&
      Number.isInteger(configuredServerPort) &&
      configuredServerPort > 0 &&
      configuredServerPort <= 65535
        ? configuredServerPort
        : undefined
    server.startServer(serverPort)

    void configWindowReady.catch((error) => {
      log.error('Failed to open the config window during startup.', error)
    })

    app.on('activate', async () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        await windowModule.openWindow('config')
      }
    })

    try {
      await proxyReady
      if (config.getConfig('check_update') !== false) {
        const updater = await import('./modules/updater')
        void updater.runStartupUpdateCheck()
      }
    } catch (error) {
      log.error('Failed to apply the startup proxy; skipped the startup update check.', error)
    }
  })

  app.on('window-all-closed', () => {
    if (process.platform === 'darwin') {
      return
    }

    // AiPot may destroy idle windows to release renderer memory while it
    // stays resident in the tray. Only quit when the user explicitly turned
    // off close-to-tray.
    if (config.getConfig('close_to_tray') !== false) {
      return
    }

    app.quit()
  })

  app.on('before-quit', () => {
    windowModule.markAppQuitting()
  })

  app.on('will-quit', () => {
    hotkey.unregisterGlobalShortcuts()
    clipboard.stopClipboardMonitor()
    server.stopServer()
  })
}
