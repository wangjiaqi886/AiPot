import { invokeCommand } from '@/renderer/lib/electron/command'

/**
 * Write text to the clipboard.
 *
 * Routes through the main process (`write_clipboard_text` IPC command)
 * because the DOM path (`navigator.clipboard.writeText`) requires document
 * focus — auto-copy after a translation fires on a window that may have
 * just been hidden or lost focus, and the DOM API throws NotAllowedError
 * ("Document is not focused") there. Electron's main-process clipboard has
 * no focus requirement.
 *
 * Falls back to the DOM API if the command bridge is unavailable (e.g. in
 * unit-test environments without the preload bridge), so callers keep the
 * same Promise-based contract either way.
 */
export async function writeClipboardText(text: string) {
  try {
    await invokeCommand('write_clipboard_text', text)
    return
  } catch {
    // Bridge unavailable (tests / missing preload): use the DOM API.
    await navigator.clipboard.writeText(text)
  }
}
