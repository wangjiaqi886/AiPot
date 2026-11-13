export async function getAppConfigDirectory() {
  return window.aiPot.path.appConfigDir()
}

export async function getAppCacheDirectory() {
  return window.aiPot.path.appCacheDir()
}

export function joinPath(...segments: string[]) {
  return segments.filter(Boolean).join('/')
}
