import type { OpenDialogOptions } from '@/shared/types/electron-api'

export async function openDialog(options?: OpenDialogOptions) {
  return window.aiPot.dialog.open(options)
}
