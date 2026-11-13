export async function enableAutoStart() {
  await window.aiPot.app.setAutoStart(true)
}

export async function disableAutoStart() {
  await window.aiPot.app.setAutoStart(false)
}

export async function isAutoStartEnabled() {
  return window.aiPot.app.isAutoStartEnabled()
}
