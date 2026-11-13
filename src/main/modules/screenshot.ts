import { desktopCapturer, nativeImage, screen } from 'electron'
import { RENDERER_HOST, RENDERER_SCHEME, SCREENSHOT_PATH } from './rendererProtocol'

export interface Point {
  x: number
  y: number
}

export interface Rect extends Point {
  width: number
  height: number
}

let lastCapture = nativeImage.createEmpty()
let lastCropped = nativeImage.createEmpty()
let lastScaleFactor = 1
let captureVersion = 0
let preparedCaptureAt = 0
let preparedCaptureVersion = 0

export async function captureDisplayForPoint(point: Point): Promise<void> {
  const display = screen.getDisplayNearestPoint(point) ?? screen.getPrimaryDisplay()
  lastScaleFactor = display.scaleFactor
  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: {
      width: Math.round(display.size.width * display.scaleFactor),
      height: Math.round(display.size.height * display.scaleFactor),
    },
  })
  const source =
    sources.find((candidate) => candidate.display_id === String(display.id)) ?? sources[0]

  if (!source) {
    throw new Error('No screenshot source is available.')
  }

  lastCapture = source.thumbnail
  lastCropped = nativeImage.createEmpty()
  captureVersion += 1
}

export function cropCapture(rect: Rect): void {
  if (lastCapture.isEmpty()) {
    throw new Error('No display capture is cached.')
  }

  lastCropped = lastCapture.crop({
    x: Math.round(rect.x * lastScaleFactor),
    y: Math.round(rect.y * lastScaleFactor),
    width: Math.round(rect.width * lastScaleFactor),
    height: Math.round(rect.height * lastScaleFactor),
  })
}

export function getCaptureUrl(): string {
  if (lastCapture.isEmpty()) {
    return ''
  }

  return `${RENDERER_SCHEME}://${RENDERER_HOST}${SCREENSHOT_PATH}?v=${captureVersion}`
}

/**
 * Captures the display under the cursor before the screenshot overlay opens.
 * `consumePreparedCapture` lets the renderer's `screenshot` command reuse this
 * capture instead of taking a second (slow) screenshot.
 */
export async function prepareScreenshotCapture(): Promise<void> {
  await captureDisplayForPoint(screen.getCursorScreenPoint())
  preparedCaptureAt = Date.now()
  preparedCaptureVersion = captureVersion
}

/**
 * Returns the prepared capture URL once. The freshness window prevents a
 * stale capture from being reused if the renderer requests a new screenshot
 * much later.
 */
export function consumePreparedCapture(maxAgeMs = 3000): string {
  if (preparedCaptureAt === 0) {
    return ''
  }

  const ageMs = Date.now() - preparedCaptureAt
  const versionMatches = preparedCaptureVersion === captureVersion
  preparedCaptureAt = 0
  if (ageMs > maxAgeMs || !versionMatches) {
    return ''
  }

  return getCaptureUrl()
}

export function getCapturePng(requestedVersion = captureVersion): Buffer {
  if (lastCapture.isEmpty() || requestedVersion !== captureVersion) {
    return Buffer.alloc(0)
  }

  return lastCapture.toPNG()
}

export function getLastCroppedBase64(): string {
  if (lastCropped.isEmpty()) {
    return ''
  }

  return lastCropped.toPNG().toString('base64')
}

export function getClipboardImage() {
  return lastCropped.isEmpty() ? lastCapture : lastCropped
}
