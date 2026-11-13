import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { promisify } from 'node:util'
import { app, clipboard } from 'electron'
import { logger } from '../logger'
import type {
  SelectionCaptureFailureReason,
  SelectionCaptureMethod,
  SelectionCaptureResult,
} from '../../shared/translateWorkflow'

const execFileAsync = promisify(execFile)

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
const abortableDelay = (ms: number, signal?: AbortSignal): Promise<boolean> => {
  if (!signal) {
    return delay(ms).then(() => true)
  }
  if (signal.aborted) {
    return Promise.resolve(false)
  }

  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      signal.removeEventListener('abort', abort)
      resolve(true)
    }, ms)
    const abort = () => {
      clearTimeout(timeout)
      resolve(false)
    }
    signal.addEventListener('abort', abort, { once: true })
  })
}
const COPY_POLL_INTERVAL_MS = 20
const COPY_TIMEOUT_MS = 700
const COPY_SETTLE_DELAY_MS = 120
const COPY_RETRY_DELAY_MS = 80
const COPY_ATTEMPT_COUNT = 2
const WINDOWS_HELPER_TIMEOUT_MS = 2500
const WINDOWS_COPY_TIMEOUT_MS = 1800
const WINDOWS_UIA_SELECTION_TIMEOUT_MS = 1600

// Improved PowerShell fallback used only when the native helper cannot run.
// It captures the foreground window, restores it, sends Ctrl+C with
// keybd_event, and watches the clipboard sequence number. Unlike the old
// marker-based implementation it never overwrites the clipboard before
// copying, which was the cause of "the active application did not put selected
// text on the clipboard" in several apps.
const WINDOWS_COPY_COMMAND = `
$ErrorActionPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class AiPotSelectionInput {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
  [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint a, uint b, bool f);
  [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
  [DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);
  [DllImport("user32.dll")] public static extern uint GetClipboardSequenceNumber();
  public static void Focus(IntPtr target) {
    if (target == IntPtr.Zero) return;
    uint pid;
    uint targetThread = GetWindowThreadProcessId(target, out pid);
    uint currentThread = GetCurrentThreadId();
    bool attached = false;
    if (targetThread != 0 && targetThread != currentThread) {
      attached = AttachThreadInput(currentThread, targetThread, true);
    }
    SetForegroundWindow(target);
    if (attached) AttachThreadInput(currentThread, targetThread, false);
  }
  public static void Copy() {
    keybd_event(0x11, 0, 0, UIntPtr.Zero);
    keybd_event(0x43, 0, 0, UIntPtr.Zero);
    System.Threading.Thread.Sleep(20);
    keybd_event(0x43, 0, 2, UIntPtr.Zero);
    keybd_event(0x11, 0, 2, UIntPtr.Zero);
  }
}
"@
$target = [AiPotSelectionInput]::GetForegroundWindow()
$sequence = [AiPotSelectionInput]::GetClipboardSequenceNumber()
[AiPotSelectionInput]::Focus($target)
Start-Sleep -Milliseconds 25
[AiPotSelectionInput]::Copy()
$deadline = [DateTime]::UtcNow.AddMilliseconds(700)
while ([DateTime]::UtcNow -lt $deadline) {
  if ([AiPotSelectionInput]::GetClipboardSequenceNumber() -ne $sequence) {
    $text = Get-Clipboard -Raw -Format Text
    if (-not [string]::IsNullOrWhiteSpace($text)) {
      [Console]::Write($text)
      exit 0
    }
  }
  Start-Sleep -Milliseconds 20
}
exit 1
`

const WINDOWS_UIA_SELECTION_COMMAND = `
$ErrorActionPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class AiPotForegroundWindow {
  [DllImport("user32.dll")]
  public static extern IntPtr GetForegroundWindow();
}
"@

function Get-TextPatternSelection($element) {
  if ($null -eq $element) {
    return $null
  }

  $pattern = $null
  if (-not $element.TryGetCurrentPattern([System.Windows.Automation.TextPattern]::Pattern, [ref]$pattern)) {
    return $null
  }

  try {
    $ranges = $pattern.GetSelection()
  } catch {
    return $null
  }

  if ($null -eq $ranges) {
    return $null
  }

  $parts = New-Object 'System.Collections.Generic.List[string]'
  foreach ($range in $ranges) {
    try {
      $text = $range.GetText(-1)
    } catch {
      $text = $null
    }

    if (-not [string]::IsNullOrWhiteSpace($text)) {
      [void]$parts.Add($text.Trim())
    }
  }

  if ($parts.Count -eq 0) {
    return $null
  }

  return [string]::Join("\`n", $parts.ToArray())
}

function Write-SelectionAndExit($text) {
  if (-not [string]::IsNullOrWhiteSpace($text)) {
    [Console]::Write($text)
    exit 0
  }
}

$element = [System.Windows.Automation.AutomationElement]::FocusedElement
for ($i = 0; $i -lt 8 -and $null -ne $element; $i += 1) {
  Write-SelectionAndExit (Get-TextPatternSelection $element)
  $element = [System.Windows.Automation.TreeWalker]::ControlViewWalker.GetParent($element)
}

$foregroundWindow = [AiPotForegroundWindow]::GetForegroundWindow()
if ($foregroundWindow -ne [IntPtr]::Zero) {
  $root = [System.Windows.Automation.AutomationElement]::FromHandle($foregroundWindow)
  if ($null -ne $root) {
    $condition = [System.Windows.Automation.PropertyCondition]::new(
      [System.Windows.Automation.AutomationElement]::IsTextPatternAvailableProperty,
      $true
    )
    $elements = $root.FindAll([System.Windows.Automation.TreeScope]::Subtree, $condition)
    foreach ($candidate in $elements) {
      Write-SelectionAndExit (Get-TextPatternSelection $candidate)
    }
  }
}

exit 1
`

let selectionClipboardCaptureDepth = 0
let selectionClipboardBaselineVersion = 0
let selectionClipboardBaselineText: string | null = null

export function isSelectionClipboardCaptureActive(): boolean {
  return selectionClipboardCaptureDepth > 0
}

export function getSelectionClipboardCaptureBaseline(): {
  version: number
  text: string | null
} {
  return {
    version: selectionClipboardBaselineVersion,
    text: selectionClipboardBaselineText,
  }
}

async function tryExecFile(file: string, args: string[], timeout = 1000): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync(file, args, {
      windowsHide: true,
      timeout,
    })
    const text = stdout.trim()
    return text === '' ? null : text
  } catch {
    return null
  }
}

type CopyCommandResult =
  | {
      ok: true
      text?: string
    }
  | {
      ok: false
      reason: SelectionCaptureFailureReason
    }

async function readLinuxPrimarySelection(): Promise<string | null> {
  return (
    (await tryExecFile('wl-paste', ['--primary', '--no-newline'])) ??
    (await tryExecFile('xclip', ['-selection', 'primary', '-out'])) ??
    (await tryExecFile('xsel', ['--primary', '--output']))
  )
}

async function sendLinuxCopyKeystroke(): Promise<CopyCommandResult> {
  for (const [command, args] of [
    ['xdotool', ['key', 'ctrl+c']],
    ['wtype', ['-M', 'ctrl', 'c', '-m', 'ctrl']],
  ] as const) {
    try {
      await execFileAsync(command, args, {
        windowsHide: true,
        timeout: 1000,
      })
      return { ok: true }
    } catch {
      // Try the next common desktop helper.
    }
  }

  logger.warn('No supported Linux selection copy helper was available.')
  return { ok: false, reason: 'copy-helper-unavailable' }
}

async function sendMacCopyKeystroke(): Promise<CopyCommandResult> {
  try {
    await execFileAsync(
      'osascript',
      ['-e', 'tell application "System Events" to keystroke "c" using command down'],
      {
        windowsHide: true,
        timeout: 2000,
      },
    )
    return { ok: true }
  } catch (error) {
    logger.warn('macOS selection copy command failed.', {
      error: error instanceof Error ? error.message : String(error),
    })
    return { ok: false, reason: 'copy-command-failed' }
  }
}

async function sendWindowsCopyKeystroke(signal?: AbortSignal): Promise<CopyCommandResult> {
  try {
    const { stdout } = await execFileAsync(
      'powershell.exe',
      ['-NoProfile', '-Command', WINDOWS_COPY_COMMAND],
      {
        windowsHide: true,
        timeout: WINDOWS_COPY_TIMEOUT_MS,
        signal,
        maxBuffer: 1024 * 1024,
      },
    )
    const text = stdout.trim()
    if (text !== '') {
      return { ok: true, text }
    }

    return { ok: false, reason: 'copy-timeout' }
  } catch (error) {
    if (signal?.aborted) {
      return { ok: false, reason: 'copy-command-failed' }
    }
    logger.warn('Windows selection copy command failed.', {
      error: error instanceof Error ? error.message : String(error),
    })
    return { ok: false, reason: 'copy-command-failed' }
  }
}

async function readWindowsUiaSelectedText(): Promise<string | null> {
  return tryExecFile(
    'powershell.exe',
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', WINDOWS_UIA_SELECTION_COMMAND],
    WINDOWS_UIA_SELECTION_TIMEOUT_MS,
  )
}

async function readWindowsUiaSelection(): Promise<SelectionCaptureResult> {
  const text = await readWindowsUiaSelectedText()
  if (text && text.trim() !== '') {
    return {
      ok: true,
      text,
      method: 'windows-uia-selection',
    }
  }

  return {
    ok: false,
    reason: 'empty',
    method: 'windows-uia-selection',
  }
}

function getSelectionHelperPath(): string | null {
  const candidates: string[] = []
  const resourcesPath = process.resourcesPath
  if (typeof resourcesPath === 'string' && resourcesPath !== '') {
    candidates.push(path.join(resourcesPath, 'bin', 'AiPotSelectionHelper.exe'))
  }

  try {
    const appPath = app.getAppPath()
    if (typeof appPath === 'string' && appPath !== '') {
      candidates.push(path.join(appPath, 'resources', 'bin', 'AiPotSelectionHelper.exe'))
    }
  } catch {
    // Tests and early bootstrap may not provide a real Electron app object.
  }

  candidates.push(path.join(process.cwd(), 'resources', 'bin', 'AiPotSelectionHelper.exe'))
  return candidates.find((candidate) => existsSync(candidate)) ?? null
}

async function readWindowsSelectionWithHelper(): Promise<SelectionCaptureResult | null> {
  const helperPath = getSelectionHelperPath()
  if (!helperPath) {
    return null
  }

  try {
    const { stdout } = await execFileAsync(helperPath, [], {
      windowsHide: true,
      timeout: WINDOWS_HELPER_TIMEOUT_MS,
      maxBuffer: 1024 * 1024,
      encoding: 'utf8',
    })
    const text = stdout.trim()
    if (text !== '') {
      return {
        ok: true,
        text,
        method: 'windows-selection-helper',
      }
    }

    return {
      ok: false,
      reason: 'empty',
      method: 'windows-selection-helper',
    }
  } catch (error) {
    const code = (error as { code?: unknown }).code
    if (code === 2 || code === '2') {
      return {
        ok: false,
        reason: 'empty',
        method: 'windows-selection-helper',
      }
    }

    logger.debug('Native selection helper failed; falling back to PowerShell.', {
      code: code === undefined ? undefined : String(code),
      error: error instanceof Error ? error.message : String(error),
    })
    return null
  }
}

async function waitForCopiedClipboardValue(
  marker: string,
  signal?: AbortSignal,
): Promise<string | null> {
  const deadline = Date.now() + COPY_TIMEOUT_MS

  while (Date.now() < deadline) {
    if (!(await abortableDelay(COPY_POLL_INTERVAL_MS, signal))) {
      return null
    }
    const currentText = clipboard.readText()
    if (currentText !== marker) {
      return currentText
    }
  }

  return null
}

async function readClipboardFallbackSelection(
  method: SelectionCaptureMethod,
  copySelection: (signal?: AbortSignal) => Promise<CopyCommandResult>,
): Promise<SelectionCaptureResult>
async function readClipboardFallbackSelection(
  method: SelectionCaptureMethod,
  copySelection: (signal?: AbortSignal) => Promise<CopyCommandResult>,
  signal: AbortSignal,
): Promise<SelectionCaptureResult | null>
async function readClipboardFallbackSelection(
  method: SelectionCaptureMethod,
  copySelection: (signal?: AbortSignal) => Promise<CopyCommandResult>,
  signal?: AbortSignal,
): Promise<SelectionCaptureResult | null> {
  if (signal?.aborted) {
    return null
  }

  const previousText = clipboard.readText()
  const marker = `__AIPOT_SELECTION_${randomUUID()}__`
  let copiedClipboardValue: string | null = null
  let result: SelectionCaptureResult | null = null

  selectionClipboardCaptureDepth += 1
  try {
    if (signal?.aborted) {
      return null
    }
    clipboard.writeText(marker)

    for (let attempt = 0; attempt < COPY_ATTEMPT_COUNT; attempt += 1) {
      if (
        (attempt > 0 && !(await abortableDelay(COPY_RETRY_DELAY_MS, signal))) ||
        !(await abortableDelay(COPY_SETTLE_DELAY_MS, signal))
      ) {
        return null
      }

      const copyResult = await copySelection(signal)
      if (signal?.aborted) {
        return null
      }
      if (!copyResult.ok) {
        result = {
          ok: false,
          reason: copyResult.reason,
          method,
        }
        return result
      }

      if (copyResult.text && copyResult.text.trim() !== '') {
        copiedClipboardValue = copyResult.text
        break
      }

      copiedClipboardValue = await waitForCopiedClipboardValue(marker, signal)
      if (signal?.aborted) {
        return null
      }
      if (copiedClipboardValue !== null) {
        break
      }
    }

    if (copiedClipboardValue === null) {
      result = {
        ok: false,
        reason: 'copy-timeout',
        method,
      }
      return result
    }

    if (copiedClipboardValue.trim() === '') {
      result = {
        ok: false,
        reason: 'empty',
        method,
      }
      return result
    }

    result = {
      ok: true,
      text: copiedClipboardValue,
      method,
    }
    return result
  } finally {
    try {
      const currentText = clipboard.readText()
      if (
        currentText === marker ||
        (copiedClipboardValue !== null && currentText === copiedClipboardValue)
      ) {
        clipboard.writeText(previousText)
      }
      selectionClipboardBaselineVersion += 1
      selectionClipboardBaselineText = clipboard.readText()
    } finally {
      selectionClipboardCaptureDepth -= 1
    }
  }
}

async function readLinuxSelectedText(): Promise<SelectionCaptureResult> {
  const primarySelection = await readLinuxPrimarySelection()
  if (primarySelection && primarySelection.trim() !== '') {
    return {
      ok: true,
      text: primarySelection,
      method: 'linux-primary-selection',
    }
  }

  return readClipboardFallbackSelection('linux-clipboard-fallback', sendLinuxCopyKeystroke)
}

async function withWindowsClipboardCapture<T>(operation: () => Promise<T>): Promise<T> {
  selectionClipboardCaptureDepth += 1
  try {
    return await operation()
  } finally {
    try {
      selectionClipboardBaselineVersion += 1
      selectionClipboardBaselineText = clipboard.readText()
    } finally {
      selectionClipboardCaptureDepth -= 1
    }
  }
}

async function readWindowsClipboardFallback(
  signal?: AbortSignal,
): Promise<SelectionCaptureResult | null> {
  if (signal?.aborted) {
    return null
  }

  return withWindowsClipboardCapture(async () => {
    const previousText = clipboard.readText()
    try {
      // Give UI Automation a brief head start. If it finds the selection, the
      // abort signal stops this fallback before it touches the clipboard.
      if (!(await abortableDelay(80, signal))) {
        return null
      }
      const copyResult = await sendWindowsCopyKeystroke(signal)
      if (signal?.aborted) {
        return null
      }

      if (!copyResult.ok) {
        return {
          ok: false,
          reason: copyResult.reason,
          method: 'windows-clipboard-fallback',
        }
      }

      if (copyResult.text && copyResult.text.trim() !== '') {
        return {
          ok: true,
          text: copyResult.text,
          method: 'windows-clipboard-fallback',
        }
      }

      const deadline = Date.now() + COPY_TIMEOUT_MS
      while (Date.now() < deadline) {
        if (!(await abortableDelay(COPY_POLL_INTERVAL_MS, signal))) {
          return null
        }
        const currentText = clipboard.readText()
        if (currentText && currentText !== previousText) {
          return {
            ok: true,
            text: currentText,
            method: 'windows-clipboard-fallback',
          }
        }
      }

      return {
        ok: false,
        reason: 'copy-timeout',
        method: 'windows-clipboard-fallback',
      }
    } finally {
      // Put the user's previous clipboard text back so neither the clipboard
      // monitor nor the next application sees a stale selection copy.
      if (previousText !== '' && clipboard.readText() !== previousText) {
        clipboard.writeText(previousText)
      }
    }
  })
}

async function readWindowsSelectedText(): Promise<SelectionCaptureResult> {
  // Fast path: the native helper starts in a few milliseconds and sends
  // Ctrl+C to the captured foreground window without PowerShell startup cost.
  const helperResult = await withWindowsClipboardCapture(readWindowsSelectionWithHelper)
  if (helperResult) {
    if (helperResult.ok) {
      return helperResult
    }

    // The helper reports "empty" both for "no selection at all" and for
    // "this app ignored Ctrl+C / the helper's quick UIA probe". Several
    // desktop apps (WPF, Qt, Electron editors) only answer the fuller UIA
    // TextPattern scan, which the helper runs with a very short timeout.
    // Before giving up, retry with the PowerShell UIA pass (a deeper scan
    // up the focused element tree and across the whole foreground window).
    // Keep the parallel clipboard fallback running so apps that eventually
    // do answer Ctrl+C are still covered.
    logger.debug('Selection helper reported empty; retrying with UIA fallback.', {
      reason: helperResult.reason,
      method: helperResult.method,
    })
    const retryAbortController = new AbortController()
    const clipboardFallback = readWindowsClipboardFallback(retryAbortController.signal)
    const uiaSelection = readWindowsUiaSelection().then((result) => {
      if (result.ok) {
        retryAbortController.abort()
      }
      return result
    })

    const first = await Promise.race([uiaSelection, clipboardFallback])
    if (first === null) {
      return await uiaSelection
    }
    if (first.ok) {
      if (first.method === 'windows-uia-selection') {
        await clipboardFallback
      }
      return first
    }

    if (first.method === 'windows-uia-selection') {
      return (await clipboardFallback) ?? first
    }

    const uiaResult = await uiaSelection
    return uiaResult.ok ? uiaResult : first
  }

  // Fallback for machines where the helper is missing or blocked by an
  // antivirus/sandbox policy. Keep the two PowerShell paths parallel, but use
  // the copy command's stdout directly instead of a marker round-trip.
  const fallbackAbortController = new AbortController()
  const clipboardFallback = readWindowsClipboardFallback(fallbackAbortController.signal)
  const uiaSelection = readWindowsUiaSelection().then((result) => {
    if (result.ok) {
      fallbackAbortController.abort()
    }
    return result
  })

  const first = await Promise.race([uiaSelection, clipboardFallback])
  if (first === null) {
    return uiaSelection
  }
  if (first.ok) {
    if (first.method === 'windows-uia-selection') {
      await clipboardFallback
    }
    return first
  }

  if (first.method === 'windows-uia-selection') {
    return (await clipboardFallback) ?? first
  }

  const uiaResult = await uiaSelection
  return uiaResult.ok ? uiaResult : first
}

async function readMacSelectedText(): Promise<SelectionCaptureResult> {
  return readClipboardFallbackSelection('macos-clipboard-fallback', sendMacCopyKeystroke)
}

export async function readSelectedText(): Promise<SelectionCaptureResult> {
  switch (process.platform) {
    case 'linux':
      return readLinuxSelectedText()
    case 'win32':
      return readWindowsSelectedText()
    case 'darwin':
      return readMacSelectedText()
    default:
      return {
        ok: false,
        reason: 'unsupported-platform',
        method: 'unsupported-clipboard-fallback',
      }
  }
}
