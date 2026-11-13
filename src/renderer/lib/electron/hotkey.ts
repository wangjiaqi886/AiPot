export async function unregisterHotkey(shortcut: string) {
  await window.aiPot.hotkey.unregister(shortcut)
}

export async function isHotkeyRegistered(shortcut: string) {
  return window.aiPot.hotkey.isRegistered(shortcut)
}
