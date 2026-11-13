import type { FsOptions } from '@/shared/types/electron-api'

export const FileBase = {
  Config: 'AppConfig',
  Cache: 'AppCache',
  Log: 'AppLog',
} as const

export async function readTextFile(path: string, options?: FsOptions) {
  return window.aiPot.fs.readTextFile(path, options)
}

export async function readBinaryFile(path: string, options?: FsOptions) {
  const bytes = await window.aiPot.fs.readFile(path, options)
  return new Uint8Array(bytes)
}
