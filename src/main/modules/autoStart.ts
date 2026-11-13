export const AUTO_START_HIDDEN_ARG = '--aipot-start-hidden'
export const AUTO_START_PREVIEW_MS = 500

export function isAutoStartLaunch(argv: readonly string[] = process.argv): boolean {
  return argv.includes(AUTO_START_HIDDEN_ARG)
}
