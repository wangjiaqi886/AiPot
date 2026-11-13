import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = fileURLToPath(new URL('..', import.meta.url))
const source = path.join(repoRoot, 'resources', 'win', 'AiPotSelectionHelper.cs')
const outputDirectory = path.join(repoRoot, 'resources', 'bin')
const output = path.join(outputDirectory, 'AiPotSelectionHelper.exe')

const cscCandidates = [
  'C:\\Windows\\Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe',
  'C:\\Windows\\Microsoft.NET\\Framework\\v4.0.30319\\csc.exe',
]

const csc = cscCandidates.find((candidate) => existsSync(candidate))
if (!csc) {
  console.warn(
    '[selection-helper] csc.exe was not found. Skipping the native helper build; ' +
      'AiPot will fall back to the PowerShell selection capture path.',
  )
  process.exit(0)
}

if (!existsSync(source)) {
  console.warn(`[selection-helper] Source file not found: ${source}`)
  process.exit(0)
}

const frameworkRoot = path.dirname(csc)
const references = ['UIAutomationClient.dll', 'UIAutomationTypes.dll', 'WindowsBase.dll'].map(
  (name) => path.join(frameworkRoot, 'WPF', name),
)
const missingReference = references.find((reference) => !existsSync(reference))
if (missingReference) {
  console.warn(`[selection-helper] Missing reference assembly: ${missingReference}`)
  process.exit(0)
}

mkdirSync(outputDirectory, { recursive: true })
const args = [
  '/nologo',
  '/target:winexe',
  '/platform:x64',
  '/optimize+',
  `/out:${output}`,
  ...references.map((reference) => `/r:${reference}`),
  source,
]

console.log('[selection-helper] Building native selection helper...')
execFileSync(csc, args, { stdio: 'inherit' })
console.log(`[selection-helper] Built ${output}`)
