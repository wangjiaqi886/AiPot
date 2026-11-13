import path from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  app,
  BrowserWindow,
  type Display,
  net,
  protocol,
  screen,
  type BrowserWindowConstructorOptions,
  type WebContents,
} from 'electron'
import { getConfig, setConfig } from './config'
import {
  RENDERER_HOST,
  RENDERER_SCHEME,
  resolveRendererFile,
  SCREENSHOT_PATH,
} from './rendererProtocol'
import { logger } from '../logger'
import {
  calculateAdaptiveTranslateWindowSize,
  MIN_TRANSLATE_WINDOW_SIZE,
} from '../../shared/translateWindowSizing'
import { getAppIconPath } from './appIdentity'

export type WindowLabel = 'config' | 'translate' | 'recognize' | 'screenshot' | 'updater'
type UpdaterPresentation = 'full' | 'notification'

export interface OpenWindowOptions {
  autoHideAfterReadyMs?: number
  /**
   * Show the window without activating it. Used by selection translation so
   * the capture helper can still send Ctrl+C to the source application while
   * the translation window is already loading.
   */
  showInactive?: boolean
  /**
   * Return as soon as the renderer load starts. Events sent with
   * `sendToWindow` are queued until the renderer reports `rendererReady`.
   */
  awaitLoad?: boolean
  /**
   * Do not show the window on `ready-to-show`. The caller shows it later,
   * after the screenshot image is ready (avoiding a black flash and avoiding
   * capturing our own overlay).
   */
  deferShow?: boolean
}

const windows = new Map<WindowLabel, BrowserWindow>()
const windowLabelsByWebContentsId = new Map<number, WindowLabel>()
const readyWindows = new Set<WindowLabel>()
const pendingWindowEvents = new Map<WindowLabel, Array<{ event: string; payload: unknown }>>()
// Last 'aipot://window-shown' emit per window (ms epoch) — suppresses the
// duplicate show that the selection workflow's showInactive→focus pair fires.
const windowShownEventDebounce = new Map<WindowLabel, number>()
const hiddenWindowDestroyTimers = new Map<WindowLabel, NodeJS.Timeout>()
const windowCreatedAt = new Map<WindowLabel, number>()
const MAX_PENDING_WINDOW_EVENTS_PER_WINDOW = 25

// Hidden windows are kept warm for fast shortcut wake-up, then destroyed to
// release their renderer process. Values are overridable through config.json:
// `<label>_window_idle_destroy_seconds` (0 = destroy immediately).
const DEFAULT_HIDDEN_WINDOW_DESTROY_MS: Record<WindowLabel, number> = {
  config: 30_000,
  translate: 300_000,
  recognize: 120_000,
  screenshot: 5_000,
  updater: 30_000,
}

let updaterPresentation: UpdaterPresentation = 'full'
let appIsQuitting = false
let translateResizeTimer: NodeJS.Timeout | null = null

interface WindowDefinition {
  width: number
  height: number
  minWidth?: number
  minHeight?: number
  skipTaskbar?: boolean
  fullscreen?: boolean
  alwaysOnTop?: boolean
  transparent?: boolean
  resizable?: boolean
  backgroundColor?: string
}

const windowDefinitions: Record<WindowLabel, WindowDefinition> = {
  config: {
    width: 800,
    height: 600,
    minWidth: 800,
    minHeight: 400,
    resizable: true,
  },
  translate: {
    width: MIN_TRANSLATE_WINDOW_SIZE.width,
    height: MIN_TRANSLATE_WINDOW_SIZE.height,
    transparent: true,
    resizable: true,
  },
  recognize: {
    width: 900,
    height: 520,
    transparent: true,
    resizable: true,
  },
  screenshot: {
    width: 800,
    height: 600,
    skipTaskbar: true,
    alwaysOnTop: true,
    transparent: true,
    resizable: false,
  },
  updater: {
    width: 720,
    height: 520,
    minWidth: 640,
    minHeight: 440,
    resizable: true,
  },
}

const updaterNotificationDefinition: WindowDefinition = {
  width: 360,
  height: 220,
  minWidth: 360,
  minHeight: 220,
  skipTaskbar: true,
  resizable: false,
}

function getRendererRoot(): string {
  return path.join(__dirname, '..', 'renderer')
}

function shouldUseDevRendererUrl(): boolean {
  return !app.isPackaged && Boolean(process.env.ELECTRON_RENDERER_URL)
}

function rendererUrl(label: WindowLabel, presentation: UpdaterPresentation = 'full'): string {
  const devRendererUrl = process.env.ELECTRON_RENDERER_URL
  if (shouldUseDevRendererUrl() && devRendererUrl) {
    const url = new URL(devRendererUrl)
    url.searchParams.set('window', label)
    if (label === 'updater') {
      url.searchParams.set('presentation', presentation)
    }
    return url.toString()
  }

  // Packaged builds serve the renderer over `aipot://` so the page has a
  // non-`file:` origin. PaddleOCR.js (`ensureServedFromHttp`) refuses to fetch
  // its model assets on a `file:` origin, which broke OCR in packaged builds.
  const url = new URL(`${RENDERER_SCHEME}://${RENDERER_HOST}/index.html`)
  url.searchParams.set('window', label)
  if (label === 'updater') {
    url.searchParams.set('presentation', presentation)
  }
  return url.toString()
}

// Serves the packaged renderer bundle and in-memory screenshot previews over
// the custom scheme. Must run after the app is ready and before any window loads.
export function registerRendererProtocol(): void {
  const root = getRendererRoot()
  protocol.handle(RENDERER_SCHEME, async (request) => {
    const requestUrl = new URL(request.url)
    if (requestUrl.hostname === RENDERER_HOST && requestUrl.pathname === SCREENSHOT_PATH) {
      const { getCapturePng } = await import('./screenshot')
      const png = getCapturePng(Number(requestUrl.searchParams.get('v')))
      if (png.length === 0) {
        return new Response('Not found', { status: 404 })
      }
      return new Response(new Uint8Array(png), {
        headers: {
          'Cache-Control': 'no-store',
          'Content-Type': 'image/png',
          'X-Content-Type-Options': 'nosniff',
        },
      })
    }

    if (shouldUseDevRendererUrl()) {
      return new Response('Not found', { status: 404 })
    }

    const filePath = resolveRendererFile(request.url, root)
    if (!filePath) {
      return new Response('Not found', { status: 404 })
    }
    return net.fetch(pathToFileURL(filePath).toString())
  })
}

async function loadRenderer(window: BrowserWindow, label: WindowLabel) {
  await window.loadURL(rendererUrl(label, label === 'updater' ? updaterPresentation : 'full'))
}

function positionTranslateWindow(window: BrowserWindow) {
  const [width, height] = window.getSize()
  const rememberedPosition = getRememberedTranslateWindowPosition(width, height)
  if (rememberedPosition) {
    window.setPosition(rememberedPosition.x, rememberedPosition.y)
    return
  }

  const cursor = screen.getCursorScreenPoint()
  const display = screen.getDisplayNearestPoint(cursor) ?? screen.getPrimaryDisplay()
  const bounds = display.workArea

  const x = Math.max(bounds.x, Math.min(cursor.x, bounds.x + bounds.width - width))
  const y = Math.max(bounds.y, Math.min(cursor.y, bounds.y + bounds.height - height))
  window.setPosition(x, y)
}

function getRememberedTranslateWindowPosition(
  width: number,
  height: number,
): { x: number; y: number } | null {
  if (getConfig('translate_window_position') !== 'pre_state') {
    return null
  }

  const storedX = Number(getConfig('translate_window_position_x'))
  const storedY = Number(getConfig('translate_window_position_y'))
  if (!Number.isFinite(storedX) || !Number.isFinite(storedY)) {
    return null
  }

  const display = screen.getDisplayNearestPoint({ x: storedX, y: storedY })
  const bounds = display.workArea
  return {
    x: Math.max(bounds.x, Math.min(storedX, bounds.x + bounds.width - width)),
    y: Math.max(bounds.y, Math.min(storedY, bounds.y + bounds.height - height)),
  }
}

function positionUpdaterNotification(window: BrowserWindow) {
  const display = screen.getPrimaryDisplay()
  const bounds = display.workArea
  const [width, height] = window.getSize()
  window.setPosition(bounds.x + bounds.width - width - 16, bounds.y + bounds.height - height - 16)
}

export interface DisplayInfo {
  id: number
  position: { x: number; y: number }
  size: { width: number; height: number }
  scaleFactor: number
}

function getUpdaterDefinition(presentation: UpdaterPresentation): WindowDefinition {
  return presentation === 'notification' ? updaterNotificationDefinition : windowDefinitions.updater
}

function applyUpdaterPresentation(window: BrowserWindow, presentation: UpdaterPresentation): void {
  const definition = getUpdaterDefinition(presentation)
  window.setMinimumSize(definition.minWidth ?? 0, definition.minHeight ?? 0)
  window.setResizable(definition.resizable !== false)
  window.setSkipTaskbar(definition.skipTaskbar === true)
  window.setSize(definition.width, definition.height)
}

async function switchExistingUpdaterPresentation(
  window: BrowserWindow,
  presentation: UpdaterPresentation,
): Promise<void> {
  updaterPresentation = presentation
  readyWindows.delete('updater')
  applyUpdaterPresentation(window, presentation)
  await window.loadURL(rendererUrl('updater', presentation))

  if (presentation === 'notification') {
    positionUpdaterNotification(window)
  } else {
    window.center()
  }
  showWindowInForeground(window, 'updater')
}

function getTranslateWindowSize(definition: WindowDefinition): { width: number; height: number } {
  if (getConfig('translate_remember_window_size') !== true) {
    return {
      width: definition.width,
      height: definition.height,
    }
  }

  const savedSize = getConfig('translate_window_size')
  const width = Number(
    savedSize && typeof savedSize === 'object' && 'width' in savedSize
      ? savedSize.width
      : getConfig('translate_window_width'),
  )
  const height = Number(
    savedSize && typeof savedSize === 'object' && 'height' in savedSize
      ? savedSize.height
      : getConfig('translate_window_height'),
  )
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 240 || height < 180) {
    return {
      width: definition.width,
      height: definition.height,
    }
  }

  return {
    width,
    height,
  }
}

function toDisplayInfo(display: Display): DisplayInfo {
  return {
    id: display.id,
    position: {
      x: display.bounds.x,
      y: display.bounds.y,
    },
    size: {
      width: display.bounds.width,
      height: display.bounds.height,
    },
    scaleFactor: display.scaleFactor,
  }
}

function emitWindowEvent(window: BrowserWindow, event: string): void {
  if (window.isDestroyed() || window.webContents.isDestroyed()) {
    return
  }

  window.webContents.send('app:event', {
    event,
  })
}

function flushPendingWindowEvents(label: WindowLabel): void {
  const window = windows.get(label)
  if (!window || window.isDestroyed() || window.webContents.isDestroyed()) {
    return
  }

  const events = pendingWindowEvents.get(label) ?? []
  pendingWindowEvents.delete(label)
  if (events.length > 0) {
    logger.debug('Flushing queued window events.', {
      window: label,
      count: events.length,
    })
  }
  for (const queuedEvent of events) {
    window.webContents.send('app:event', queuedEvent)
  }
}

function queuePendingWindowEvent(
  label: WindowLabel,
  event: string,
  payload: unknown,
  reason: 'missing' | 'pending',
): void {
  const events = pendingWindowEvents.get(label) ?? []
  if (events.length >= MAX_PENDING_WINDOW_EVENTS_PER_WINDOW) {
    const droppedEvent = events.shift()
    logger.warn('Dropped queued window event because the pending queue is full.', {
      window: label,
      reason,
      droppedEvent: droppedEvent?.event,
      maxQueueLength: MAX_PENDING_WINDOW_EVENTS_PER_WINDOW,
    })
  }

  events.push({ event, payload })
  pendingWindowEvents.set(label, events)
  logger.debug(`Queued event for ${reason} window.`, {
    window: label,
    event,
    queueLength: events.length,
  })
}

function cancelHiddenWindowDestroy(label: WindowLabel): void {
  const timer = hiddenWindowDestroyTimers.get(label)
  if (timer) {
    clearTimeout(timer)
    hiddenWindowDestroyTimers.delete(label)
  }
}

function hiddenWindowDestroyDelayMs(label: WindowLabel): number {
  const configured = Number(getConfig(`${label}_window_idle_destroy_seconds`))
  if (Number.isFinite(configured) && configured >= 0) {
    return configured * 1000
  }

  // The pre-created translate standby must never be destroyed while hidden,
  // so opting into `translate_precreate` implies an infinite idle delay.
  if (label === 'translate' && getConfig('translate_precreate') === true) {
    return Number.POSITIVE_INFINITY
  }

  return DEFAULT_HIDDEN_WINDOW_DESTROY_MS[label]
}

function scheduleHiddenWindowDestroy(label: WindowLabel, window: BrowserWindow): void {
  cancelHiddenWindowDestroy(label)
  if (appIsQuitting) {
    return
  }

  const delayMs = hiddenWindowDestroyDelayMs(label)
  // Infinity (the pre-created translate window's "never destroy while
  // hidden" policy) must skip arming the timer entirely: setTimeout clamps
  // non-finite delays to 1 ms, which would destroy the standby window.
  if (!Number.isFinite(delayMs)) {
    return
  }
  const timer = setTimeout(() => {
    hiddenWindowDestroyTimers.delete(label)
    if (window.isDestroyed() || window.isVisible()) {
      return
    }

    logger.debug('Destroying idle hidden window to release memory.', {
      window: label,
      delayMs,
    })
    window.destroy()
  }, delayMs)
  hiddenWindowDestroyTimers.set(label, timer)
}

function showWindowInForeground(window: BrowserWindow, label: WindowLabel): void {
  cancelHiddenWindowDestroy(label)
  const restoreAlwaysOnTop = window.isAlwaysOnTop()

  if (label === 'translate' && !restoreAlwaysOnTop) {
    window.setAlwaysOnTop(true)
  }

  window.show()
  window.focus()

  if (label === 'translate' && !restoreAlwaysOnTop) {
    setTimeout(() => {
      if (!window.isDestroyed() && !window.webContents.isDestroyed()) {
        window.setAlwaysOnTop(false)
      }
    }, 300)
  }
}

function showWindowInactive(window: BrowserWindow, label: WindowLabel): void {
  cancelHiddenWindowDestroy(label)
  const restoreAlwaysOnTop = window.isAlwaysOnTop()

  if (label === 'translate' && !restoreAlwaysOnTop) {
    window.setAlwaysOnTop(true)
  }

  window.showInactive()

  if (label === 'translate' && !restoreAlwaysOnTop) {
    setTimeout(() => {
      if (!window.isDestroyed() && !window.webContents.isDestroyed()) {
        window.setAlwaysOnTop(false)
      }
    }, 300)
  }
}

function createBrowserWindow(
  label: WindowLabel,
  openOptions: OpenWindowOptions = {},
): BrowserWindow {
  logger.debug('Creating window.', {
    window: label,
  })

  const definition =
    label === 'updater' && updaterPresentation === 'notification'
      ? updaterNotificationDefinition
      : windowDefinitions[label]
  const size = label === 'translate' ? getTranslateWindowSize(definition) : definition
  const screenshotDisplay =
    label === 'screenshot'
      ? (screen.getDisplayNearestPoint(screen.getCursorScreenPoint()) ?? screen.getPrimaryDisplay())
      : undefined
  const screenshotBounds = screenshotDisplay?.bounds
  const options: BrowserWindowConstructorOptions = {
    x: screenshotBounds?.x,
    y: screenshotBounds?.y,
    width: screenshotBounds?.width ?? size.width,
    height: screenshotBounds?.height ?? size.height,
    minWidth: definition.minWidth,
    minHeight: definition.minHeight,
    show: false,
    frame: false,
    thickFrame: true,
    transparent: definition.transparent,
    backgroundColor: definition.backgroundColor,
    skipTaskbar: definition.skipTaskbar,
    fullscreen: definition.fullscreen,
    alwaysOnTop: definition.alwaysOnTop,
    resizable: definition.resizable,
    icon: getAppIconPath(),
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      spellcheck: false,
      backgroundThrottling: true,
    },
  }

  const window = new BrowserWindow(options)
  windowCreatedAt.set(label, Date.now())
  if (definition.alwaysOnTop === true) {
    window.setAlwaysOnTop(true, 'screen-saver')
  }
  const webContentsId = window.webContents.id
  windows.set(label, window)
  windowLabelsByWebContentsId.set(webContentsId, label)

  window.once('ready-to-show', () => {
    if (label === 'translate') {
      positionTranslateWindow(window)
    } else if (label === 'updater' && updaterPresentation === 'notification') {
      positionUpdaterNotification(window)
    } else if (label === 'config' || label === 'recognize' || label === 'updater') {
      window.center()
    }
    if (openOptions.showInactive) {
      showWindowInactive(window, label)
    } else if (!openOptions.deferShow) {
      showWindowInForeground(window, label)
    }
    if (openOptions.autoHideAfterReadyMs !== undefined) {
      setTimeout(() => {
        if (!window.isDestroyed()) {
          window.hide()
        }
      }, openOptions.autoHideAfterReadyMs)
    }
    logger.debug('Window ready.', {
      window: label,
      openMs: Date.now() - (windowCreatedAt.get(label) ?? Date.now()),
    })
  })

  window.on('focus', () => emitWindowEvent(window, 'aipot://focus'))
  window.on('blur', () => emitWindowEvent(window, 'aipot://blur'))
  window.on('move', () => emitWindowEvent(window, 'aipot://move'))
  window.on('show', () => {
    cancelHiddenWindowDestroy(label)
    // Lets the renderer replay its entrance animation each time the window
    // is shown (the pre-created standby window is shown, not remounted).
    // Debounced: the selection workflow shows the window inactive and then
    // focuses it, which fires 'show' twice in quick succession — replaying
    // the entrance twice reads as a visible flash.
    const lastEmitted = windowShownEventDebounce.get(label) ?? 0
    const now = Date.now()
    if (now - lastEmitted < 200) {
      return
    }
    windowShownEventDebounce.set(label, now)
    emitWindowEvent(window, 'aipot://window-shown')
  })
  window.on('hide', () => scheduleHiddenWindowDestroy(label, window))
  window.on('resize', () => {
    emitWindowEvent(window, 'aipot://resize')
    if (label !== 'translate' || getConfig('translate_remember_window_size') !== true) {
      return
    }

    if (translateResizeTimer) {
      clearTimeout(translateResizeTimer)
    }
    translateResizeTimer = setTimeout(() => {
      if (window.isDestroyed()) {
        return
      }
      const [width, height] = window.getSize()
      void setConfig('translate_window_size', { width, height }).catch((error) => {
        logger.error('Failed to save translate window size.', error)
      })
    }, 100)
  })
  window.on('close', (event) => {
    const closeToTray = getConfig('close_to_tray') !== false
    if (label !== 'config' || appIsQuitting || !closeToTray) {
      return
    }

    event.preventDefault()
    window.hide()
  })

  window.on('closed', () => {
    cancelHiddenWindowDestroy(label)
    windowCreatedAt.delete(label)
    windows.delete(label)
    windowLabelsByWebContentsId.delete(webContentsId)
    readyWindows.delete(label)
    pendingWindowEvents.delete(label)
    windowShownEventDebounce.delete(label)
  })

  return window
}

export async function openWindow(
  label: WindowLabel,
  options: OpenWindowOptions = {},
): Promise<BrowserWindow> {
  if (label === 'updater') {
    updaterPresentation = 'full'
  }

  const existing = windows.get(label)
  if (existing && !existing.isDestroyed()) {
    logger.debug('Focusing existing window.', {
      window: label,
    })
    if (label === 'updater') {
      await switchExistingUpdaterPresentation(existing, 'full')
      return existing
    }
    if (options.showInactive) {
      if (label === 'translate') {
        positionTranslateWindow(existing)
      }
      showWindowInactive(existing, label)
      return existing
    }
    focusWindow(label)
    return existing
  }

  logger.debug('Opening new window.', {
    window: label,
  })
  const window = createBrowserWindow(label, options)
  const loadPromise = loadRenderer(window, label)
  if (options.awaitLoad === false) {
    void loadPromise.catch((error) => {
      logger.error('Failed to load the renderer for a window.', error, {
        window: label,
      })
    })
    return window
  }

  await loadPromise
  return window
}

export async function openUpdaterNotification(): Promise<BrowserWindow> {
  updaterPresentation = 'notification'

  const existing = windows.get('updater')
  if (existing && !existing.isDestroyed()) {
    await switchExistingUpdaterPresentation(existing, 'notification')
    return existing
  }

  logger.debug('Opening updater notification window.')
  const window = createBrowserWindow('updater')
  await loadRenderer(window, 'updater')
  return window
}

export function focusWindow(label: WindowLabel): void {
  const window = windows.get(label)
  if (!window || window.isDestroyed()) {
    return
  }

  if (window.isMinimized()) {
    window.restore()
  }
  if (label === 'translate') {
    positionTranslateWindow(window)
  }
  showWindowInForeground(window, label)
}

export function showWindow(label: WindowLabel): void {
  const window = windows.get(label)
  if (!window || window.isDestroyed()) {
    return
  }

  if (label === 'translate') {
    positionTranslateWindow(window)
  }
  showWindowInForeground(window, label)
}

export function resizeTranslateWindowForText(text: string): void {
  const window = windows.get('translate')
  const trimmedText = text.trim()
  if (
    !window ||
    window.isDestroyed() ||
    trimmedText === '' ||
    getConfig('translate_adaptive_window_size') !== true ||
    getConfig('translate_remember_window_size') === true
  ) {
    return
  }

  const display = screen.getDisplayMatching(window.getBounds())
  const appFontSize = Number(getConfig('app_font_size'))
  const size = calculateAdaptiveTranslateWindowSize({
    text: trimmedText,
    workArea: {
      width: display.workArea.width,
      height: display.workArea.height,
    },
    fontSize: appFontSize,
  })

  window.setSize(size.width, size.height)
  positionTranslateWindow(window)
}

export function sendToWindow(label: WindowLabel, event: string, payload: unknown): void {
  const window = windows.get(label)
  if (!window || window.isDestroyed()) {
    queuePendingWindowEvent(label, event, payload, 'missing')
    return
  }

  if (!readyWindows.has(label)) {
    queuePendingWindowEvent(label, event, payload, 'pending')
    return
  }

  window.webContents.send('app:event', { event, payload })
}

export function broadcastToAllWindows(channel: string, payload: unknown): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed() && !window.webContents.isDestroyed()) {
      window.webContents.send(channel, payload)
    }
  }
}

export function sendToPreferredWindow(
  preferredLabel: WindowLabel,
  event: string,
  payload: unknown,
): void {
  const preferredWindow = windows.get(preferredLabel)
  if (preferredWindow && !preferredWindow.isDestroyed()) {
    sendToWindow(preferredLabel, event, payload)
    return
  }

  for (const [label, window] of windows) {
    if (!window.isDestroyed()) {
      sendToWindow(label, event, payload)
      return
    }
  }

  queuePendingWindowEvent(preferredLabel, event, payload, 'missing')
}

export function getCurrentWindowLabel(webContents: WebContents): WindowLabel {
  return windowLabelsByWebContentsId.get(webContents.id) ?? 'config'
}

export function getCurrentWindowDisplayInfo(webContents: WebContents): DisplayInfo {
  const window = BrowserWindow.fromWebContents(webContents)
  if (window && !window.isDestroyed()) {
    return toDisplayInfo(screen.getDisplayMatching(window.getBounds()))
  }

  return toDisplayInfo(screen.getDisplayNearestPoint(screen.getCursorScreenPoint()))
}

export function getWindow(label: WindowLabel): BrowserWindow | undefined {
  return windows.get(label)
}

export function markWindowReady(label: WindowLabel): void {
  readyWindows.add(label)
  logger.debug('Window renderer ready.', {
    window: label,
    readyMs: Date.now() - (windowCreatedAt.get(label) ?? Date.now()),
  })
  flushPendingWindowEvents(label)
}

export function markAppQuitting(): void {
  appIsQuitting = true
}

/**
 * Pre-create the translate window at startup as a hidden standby so the
 * selection-translation hotkey never pays the ~500 ms cold-start cost
 * (BrowserWindow creation + renderer bundle load). The window stays hidden
 * (`deferShow`); its idle-destroy delay must be set to Infinity in
 * `DEFAULT_HIDDEN_WINDOW_DESTROY_MS` for the standby to survive, which is
 * why precreate also implies that override.
 *
 * Opt-in via config `translate_precreate: true`. Default OFF since 1.4.1:
 * the standby renderer costs ~55 MB of resident memory, and user feedback
 * prioritized the lower idle footprint (the warm-hide path already makes
 * repeat hotkey presses within 5 minutes instant). When enabled, the
 * translate idle-destroy delay is forced to Infinity so the standby is
 * never destroyed while hidden.
 */
export function precreateTranslateWindow(): void {
  if (getConfig('translate_precreate') !== true) {
    return
  }

  const existing = windows.get('translate')
  if (existing && !existing.isDestroyed()) {
    return
  }

  logger.debug('Pre-creating hidden translate window.')
  const window = createBrowserWindow('translate', { deferShow: true })
  void loadRenderer(window, 'translate').catch((error) => {
    logger.error('Failed to pre-load the translate renderer.', error)
  })
}
