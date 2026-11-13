import {
  expect,
  test,
  _electron as electron,
  type ElectronApplication,
  type Page,
} from '@playwright/test'
import electronPath from 'electron'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

// Regression test: workflow-delivered text (selection/text translate) must stay
// visible in the source area. The initial `get_text` load used to misparse the
// raw workflow text as an empty payload and clear the source textarea right
// after the `new_text` event had populated it.
test('workflow-delivered text stays visible in the translate source area', async ({
  browserName: _browserName,
}, testInfo) => {
  const testRoot = await mkdtemp(path.join(os.tmpdir(), 'AiPot-e2e-workflow-'))
  const mainConsole: string[] = []
  const pageErrors: string[] = []
  let electronApp: ElectronApplication | undefined

  try {
    await prepareConfig(testRoot)
    electronApp = await electron.launch({
      executablePath: electronPath as unknown as string,
      args: ['tests/e2e/electron-bootstrap.cjs'],
      cwd: path.resolve('.'),
      env: {
        ...process.env,
        AIPOT_E2E_ROOT: testRoot,
        ELECTRON_ENABLE_LOGGING: '1',
      },
    })
    electronApp.on('console', (message) => mainConsole.push(message.text()))

    const configWindow = await waitForWindow(electronApp, 'config')
    await configWindow.waitForLoadState('domcontentloaded')

    // Drive the same delivery path as the selection-translate hotkey: the
    // workflow stores the text, opens a fresh translate window, and sends the
    // queued `new_text` event once the renderer reports ready.
    const workflowText = 'workflow delivered source text'
    await configWindow.evaluate(async (text) => {
      await window.aiPot.command.invoke('translate_text', { text })
    }, workflowText)

    const translateWindow = await waitForWindow(electronApp, 'translate')
    translateWindow.on('pageerror', (error) => {
      pageErrors.push(error.stack ?? error.message)
    })
    await translateWindow.waitForLoadState('domcontentloaded')

    const sourceTextArea = translateWindow.locator('textarea:not([readonly])').first()
    await expect(sourceTextArea).toHaveValue(workflowText)

    // The historical bug cleared the textarea shortly after it was populated,
    // once config hydration triggered the initial `get_text` load. Confirm the
    // text survives past that window.
    await translateWindow.waitForTimeout(1_500)
    await expect(sourceTextArea).toHaveValue(workflowText)

    expect(pageErrors).toEqual([])
  } finally {
    await testInfo.attach('electron-main-console', {
      body: Buffer.from(mainConsole.join('\n')),
      contentType: 'text/plain',
    })
    await electronApp?.close().catch(() => undefined)
    await rm(testRoot, { recursive: true, force: true })
  }
})

async function waitForWindow(
  electronApp: ElectronApplication,
  expectedLabel: string,
): Promise<Page> {
  const deadline = Date.now() + 15_000
  while (Date.now() < deadline) {
    for (const page of electronApp.windows()) {
      const label = await page
        .evaluate(async () => window.aiPot?.app.getWindowLabel())
        .catch(() => null)
      if (label === expectedLabel) {
        return page
      }
    }

    await Promise.race([
      electronApp.waitForEvent('window', { timeout: 500 }).catch(() => null),
      new Promise((resolve) => setTimeout(resolve, 100)),
    ])
  }

  throw new Error(`${expectedLabel} window did not become ready within 15 seconds.`)
}

async function prepareConfig(testRoot: string): Promise<void> {
  const userData = path.join(testRoot, 'userData')
  await mkdir(userData, { recursive: true })
  await writeFile(
    path.join(userData, 'config.json'),
    `${JSON.stringify(
      {
        check_update: false,
        clipboard_monitor: false,
        close_to_tray: false,
        translate_source_language: 'en',
        translate_target_language: 'zh_cn',
        translate_hide_window: false,
        translate_service_list: [],
        recognize_service_list: ['local_model'],
        tts_service_list: [],
      },
      null,
      2,
    )}\n`,
  )
  await writeFile(
    path.join(userData, 'migration.json'),
    `${JSON.stringify({ status: 'already-migrated' }, null, 2)}\n`,
  )
}
