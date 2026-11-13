export function onAppEvent(event: string, handler: (payload: unknown) => void) {
  return window.aiPot.app.onEvent(event, handler)
}

export async function emitAppEvent(event: string, payload?: unknown) {
  await window.aiPot.app.emit(event, payload)
}
