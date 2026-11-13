import { focusWindow, openWindow, resizeTranslateWindowForText, sendToWindow } from './window'
import { readSelectedText } from './selection'
import { logger } from '../logger'
import type { TranslateWorkflowPayload } from '../../shared/translateWorkflow'

let currentWorkflowText = ''
let currentScreenshotAction: 'recognize' | 'translate' = 'recognize'
let selectionTranslateInFlight: Promise<void> | null = null

export function getCurrentWorkflowText(): string {
  return currentWorkflowText
}

export function getCurrentScreenshotAction(): 'recognize' | 'translate' {
  return currentScreenshotAction
}

export async function openConfig(): Promise<void> {
  logger.debug('Opening config window.')
  await openWindow('config')
}

export async function openTranslate(): Promise<void> {
  logger.debug('Opening translate window.')
  await openWindow('translate')
}

export async function openUpdater(): Promise<void> {
  logger.debug('Opening updater window.')
  await openWindow('updater')
}

interface SendTranslateWorkflowOptions {
  windowReady?: Promise<unknown>
  focus?: boolean
}

async function sendTranslateWorkflow(
  payload: TranslateWorkflowPayload,
  options: SendTranslateWorkflowOptions = {},
): Promise<void> {
  const text =
    payload.kind === 'text'
      ? payload.text
      : payload.kind === 'selection' && payload.capture.ok
        ? payload.capture.text
        : ''

  logger.debug('Opening text translation workflow.', {
    textLength: text.length,
    kind: payload.kind,
  })
  currentWorkflowText = text
  await (options.windowReady ?? openWindow('translate'))
  resizeTranslateWindowForText(text)
  sendToWindow('translate', 'new_text', payload)
  if (options.focus !== false) {
    focusWindow('translate')
  }
}

export async function textTranslate(text: string): Promise<void> {
  await sendTranslateWorkflow({
    kind: 'text',
    text,
  })
}

async function runSelectionTranslate(): Promise<void> {
  const startedAt = Date.now()
  logger.debug('Selection translation workflow requested.')

  // Start both paths together: the helper begins capturing the selection
  // immediately, while the renderer starts loading in the background. The
  // window is shown without activation so Ctrl+C still reaches the source app.
  const capturePromise = readSelectedText()
  const windowReady = openWindow('translate', {
    showInactive: true,
    awaitLoad: false,
  })

  const capture = await capturePromise
  logger.debug('Selection translation capture finished.', {
    durationMs: Date.now() - startedAt,
    ok: capture.ok,
    reason: capture.ok ? undefined : capture.reason,
    method: capture.method,
  })

  await sendTranslateWorkflow(
    {
      kind: 'selection',
      capture,
    },
    { windowReady },
  )
}

export function selectionTranslate(): Promise<void> {
  if (selectionTranslateInFlight) {
    logger.debug('Selection translation workflow already in progress.')
    return selectionTranslateInFlight
  }

  const run = runSelectionTranslate().finally(() => {
    if (selectionTranslateInFlight === run) {
      selectionTranslateInFlight = null
    }
  })
  selectionTranslateInFlight = run
  return run
}

export async function inputTranslate(): Promise<void> {
  logger.debug('Input translation workflow requested.')
  await sendTranslateWorkflow({
    kind: 'input',
  })
}

export async function imageTranslate(): Promise<void> {
  logger.debug('Image translation workflow requested.')
  await sendTranslateWorkflow({
    kind: 'image',
  })
}

export async function recognizeWindow(): Promise<void> {
  logger.debug('Opening recognize window workflow.')
  currentWorkflowText = ''
  await openWindow('recognize')
  sendToWindow('recognize', 'new_image', '')
}

async function startScreenshotWorkflow(action: 'recognize' | 'translate'): Promise<void> {
  const startedAt = Date.now()
  currentScreenshotAction = action

  // Direct-on-screen selection: the overlay window is transparent, so it is
  // shown immediately and the user drags a rectangle over the live screen.
  // The actual capture happens on mouse-up (renderer calls the `screenshot`
  // command), which is why there is no pre-capture here anymore.
  await openWindow('screenshot', { awaitLoad: false })
  logger.debug('Screenshot selection overlay ready.', {
    durationMs: Date.now() - startedAt,
    action,
  })
  sendToWindow('screenshot', 'capture_screenshot', action)
}

export async function ocrRecognize(): Promise<void> {
  logger.debug('OCR recognize workflow requested.')
  await startScreenshotWorkflow('recognize')
}

export async function ocrTranslate(): Promise<void> {
  logger.debug('OCR translate workflow requested.')
  await startScreenshotWorkflow('translate')
}
