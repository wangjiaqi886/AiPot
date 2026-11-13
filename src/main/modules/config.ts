import { safeStorage } from 'electron'
import Store from 'electron-store'
import { writeFileSync } from 'node:fs'
import { runDataMigration } from './data-migration'
import { logger } from '../logger'
import { type SecretCipher } from './configSecrets'
import { createConfigRepository } from './configRepository'

type ConfigValue = unknown

const store = new Store<Record<string, ConfigValue>>({
  name: 'config',
})

let migrationStarted = false

const secretCipher: SecretCipher = {
  isEncryptionAvailable: () => safeStorage.isEncryptionAvailable(),
  encryptString: (value) => safeStorage.encryptString(value),
  decryptString: (value) => {
    try {
      return safeStorage.decryptString(value)
    } catch (error) {
      logger.warn('Failed to decrypt a stored secret; it may belong to another profile.', {
        error: error instanceof Error ? error.message : String(error),
      })
      throw error
    }
  },
}

const configRepository = createConfigRepository({
  store: {
    path: store.path,
    get: (key) => store.get(key),
    set: (key, value) => store.set(key, value),
    delete: (key) => store.delete(key),
    readAll: () => store.store,
    dispatchChange: () => store.events.dispatchEvent(new Event('change')),
  },
  cipher: secretCipher,
  logger,
  writeFile: (file, data, options) => writeFileSync(file, data, options),
})

export async function initializeConfig(): Promise<void> {
  if (migrationStarted) {
    return
  }

  migrationStarted = true
  await runDataMigration()
}

export function getConfig(key: string): ConfigValue {
  return configRepository.get(key)
}

export function setConfig(key: string, value: ConfigValue): Promise<void> {
  return configRepository.set(key, value)
}

export function getRedactedConfig(key: string): ConfigValue {
  return configRepository.getRedacted(key)
}

/**
 * Returns every config key in one IPC round-trip. The renderer uses this to
 * warm its cache during startup instead of issuing dozens of `config:get`
 * calls (each key previously cost a full IPC round-trip).
 */
export function getAllConfig(): Record<string, ConfigValue> {
  const result: Record<string, ConfigValue> = {}
  for (const key of Object.keys(store.store)) {
    result[key] = configRepository.getRedacted(key)
  }

  return result
}
