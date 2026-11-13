import type { UpdateCheckResult, UpdateEvent, Unsubscribe } from '@/shared/types/electron-api'

export function checkForUpdates(): Promise<UpdateCheckResult> {
  return window.aiPot.updater.check()
}

export function downloadUpdate(): Promise<void> {
  return window.aiPot.updater.download()
}

export function installUpdate(): Promise<void> {
  return window.aiPot.updater.install()
}

export function openReleasePage(): Promise<void> {
  return window.aiPot.updater.openReleasePage()
}

export function onUpdateEvent(callback: (event: UpdateEvent) => void): Unsubscribe {
  return window.aiPot.updater.onEvent(callback)
}
