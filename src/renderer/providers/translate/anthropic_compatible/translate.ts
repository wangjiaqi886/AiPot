import {
  asRecord,
  errorMessage,
  responseMessage,
  type ProviderResponse,
} from '@/renderer/providers/shared'

import { Language } from './info'

export interface PromptItem {
  role: string
  content: string
}

/**
 * Model mapping table. Keys are AiPot service names (shown in the config UI
 * model dropdown), values are the model ids actually sent to the API.
 * Users can extend or override it from the config UI.
 */
export const DEFAULT_ANTHROPIC_MODEL_MAP: Record<string, string> = {
  'claude-opus-5-5': 'claude-opus-5-5',
  'claude-sonnet-5-5': 'claude-sonnet-5-5',
  'claude-haiku-5-5': 'claude-haiku-5-5',
}

export type AnthropicCompatibleConfig = Record<string, unknown> & {
  promptList?: PromptItem[]
  model?: string
  requestPath?: string
  apiKey?: string
  anthropicVersion?: string
  modelMap?: Record<string, string>
  stream?: boolean
  maxTokens?: string
  temperature?: string
  requestArguments?: string
}

export type SetResult = ((value: string) => void) | undefined

export interface AnthropicCompatibleTranslateOptions {
  config?: AnthropicCompatibleConfig
  setResult?: SetResult
  detect?: string
}

export interface AnthropicCompatibleRequestBody {
  kind: 'json'
  data: unknown
}

export interface AnthropicCompatibleRequestInit {
  method: 'POST'
  headers: Record<string, string>
  body: AnthropicCompatibleRequestBody
  responseType?: 2
  timeoutMs?: number
}

export type AnthropicCompatibleResponse = ProviderResponse<{ text: () => Promise<string> }>

export type AnthropicCompatibleRequest = (
  url: string,
  init: AnthropicCompatibleRequestInit,
) => Promise<AnthropicCompatibleResponse>

export interface AnthropicCompatibleDependencies {
  request: AnthropicCompatibleRequest
}

interface AnthropicMessage {
  role: 'user' | 'assistant'
  content: string
}

interface AnthropicRequestBody {
  model: string
  max_tokens: number
  system?: string
  messages: AnthropicMessage[]
  stream: boolean
  temperature?: number
}

export const DEFAULT_ANTHROPIC_COMPATIBLE_BASE_URL = 'https://api.anthropic.com'
export const DEFAULT_ANTHROPIC_VERSION = '2023-06-01'
const INVALID_RESPONSE_MESSAGE = 'The model returned an empty translation response.'
const DEFAULT_MAX_TOKENS = 4096

export function normalizeAnthropicCompatibleBaseUrl(value: string | undefined): string {
  const text = String(value ?? '').trim()
  const withScheme = /^https?:\/\//i.test(text) ? text : `https://${text}`
  return withScheme.replace(/\/+$/, '').replace(/\/v1\/messages\/?$/i, '')
}

export function resolveAnthropicMessagesUrl(value: string | undefined): string {
  const base = normalizeAnthropicCompatibleBaseUrl(value)
  return /\/v\d+$/i.test(base) ? `${base}/messages` : `${base}/v1/messages`
}

export function resolveModelId(config: AnthropicCompatibleConfig): string {
  const raw = String(config.model ?? '').trim()
  if (!raw) {
    throw new Error('Please select or enter a model.')
  }
  const modelMap = { ...DEFAULT_ANTHROPIC_MODEL_MAP, ...(config.modelMap ?? {}) }
  return String(modelMap[raw] ?? raw)
}

export function buildPrompt(
  promptList: PromptItem[],
  text: string,
  from: string,
  to: string,
  detect?: string,
): { system?: string; messages: AnthropicMessage[] } {
  const detectedLanguage = detect ? ((Language as Record<string, string>)[detect] ?? detect) : ''
  const expanded = promptList.map((item) => ({
    role: item.role,
    content: item.content
      .replaceAll('$text', text)
      .replaceAll('$from', from)
      .replaceAll('$to', to)
      .replaceAll('$detect', detectedLanguage),
  }))

  const systemParts = expanded.filter((item) => item.role === 'system')
  const conversation = expanded.filter((item) => item.role !== 'system')
  const messages: AnthropicMessage[] = conversation.map((item) => ({
    role: item.role === 'assistant' ? 'assistant' : 'user',
    content: item.content,
  }))
  if (messages.length === 0) {
    messages.push({ role: 'user', content: text })
  }

  return {
    system: systemParts.map((item) => item.content).join('\n\n') || undefined,
    messages,
  }
}

function parseOptionalFloat(value: unknown, fieldName: string): number | undefined {
  if (value === undefined || value === null || String(value).trim() === '') {
    return undefined
  }
  const parsed = Number(value)
  if (Number.isNaN(parsed)) {
    throw new Error(`Invalid ${fieldName}: ${String(value)}`)
  }
  return parsed
}

function parsePositiveInteger(value: unknown, fieldName: string, fallback: number): number {
  const parsed = parseOptionalFloat(value, fieldName)
  if (parsed === undefined) {
    return fallback
  }
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Invalid ${fieldName}: ${String(value)}`)
  }
  return parsed
}

function parseExtraRequestArguments(value: unknown): Record<string, unknown> {
  if (value === undefined || value === null || String(value).trim() === '') {
    return {}
  }
  try {
    const parsed = JSON.parse(String(value))
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>
    }
  } catch {
    // Fall through: reported at request build time.
  }
  throw new Error('Extra request arguments must be a JSON object.')
}

export function anthropicMessageText(data: unknown): string {
  const content = asRecord(data)?.content
  if (typeof content === 'string') {
    return content
  }
  if (!Array.isArray(content)) {
    return ''
  }
  let text = ''
  for (const block of content) {
    const blockRecord = asRecord(block)
    if (blockRecord?.type === 'text' && typeof blockRecord.text === 'string') {
      text += blockRecord.text
    }
  }
  return text
}

function anthropicSseText(raw: string): string {
  let text = ''
  for (const line of raw.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed.startsWith('data:')) {
      continue
    }
    const payload = trimmed.slice(5).trim()
    if (!payload || payload === '[DONE]') {
      continue
    }
    let event: unknown
    try {
      event = JSON.parse(payload)
    } catch {
      continue
    }
    const eventRecord = asRecord(event)
    if (eventRecord?.type === 'error') {
      const message = asRecord(eventRecord.error)?.message
      throw new Error(typeof message === 'string' ? message : 'Anthropic stream error.')
    }
    if (eventRecord?.type === 'message') {
      text += anthropicMessageText(eventRecord)
      continue
    }
    if (eventRecord?.type === 'content_block_delta') {
      const delta = asRecord(eventRecord.delta)
      if (delta?.type === 'text_delta' && typeof delta.text === 'string') {
        text += delta.text
      }
    }
  }
  return text
}

export async function translateAnthropicCompatible(
  text: string,
  from: string,
  to: string,
  options: AnthropicCompatibleTranslateOptions = {},
  dependencies: AnthropicCompatibleDependencies,
): Promise<string> {
  const { config = {}, setResult, detect } = options
  const model = resolveModelId(config)
  const apiKey = String(config.apiKey ?? '').trim()
  if (!apiKey) {
    throw new Error('Please configure the API key.')
  }

  const url = resolveAnthropicMessagesUrl(config.requestPath)
  const { system, messages } = buildPrompt(config.promptList ?? [], text, from, to, detect)
  const maxTokens = parsePositiveInteger(config.maxTokens, 'max_tokens', DEFAULT_MAX_TOKENS)
  const temperature = parseOptionalFloat(config.temperature, 'temperature')
  const extra = parseExtraRequestArguments(config.requestArguments)

  const requestBody: AnthropicRequestBody = {
    model,
    max_tokens: maxTokens,
    messages,
    stream: config.stream === true,
    ...extra,
  }
  if (system !== undefined) {
    requestBody.system = system
  }
  if (temperature !== undefined) {
    requestBody.temperature = temperature
  }

  const init: AnthropicCompatibleRequestInit = {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version':
        String(config.anthropicVersion ?? '').trim() || DEFAULT_ANTHROPIC_VERSION,
    },
    body: { kind: 'json', data: requestBody },
    responseType: requestBody.stream ? 2 : undefined,
    timeoutMs: 120_000,
  }

  let response: AnthropicCompatibleResponse
  try {
    response = await dependencies.request(url, init)
  } catch (error) {
    throw new Error(`Request failed: ${errorMessage(error)}`, { cause: error })
  }

  if (!response.ok) {
    const errorText = await response.text().catch(() => '')
    throw new Error(
      `HTTP ${response.status}: ${responseMessage(errorText, { directError: 'any' })}`,
    )
  }

  const raw = await response.text()
  let translation: string
  if (requestBody.stream) {
    translation = anthropicSseText(raw)
  } else {
    let data: unknown
    try {
      data = JSON.parse(raw)
    } catch {
      throw new Error(`${INVALID_RESPONSE_MESSAGE} raw: ${raw.slice(0, 300)}`)
    }
    translation = anthropicMessageText(data)
  }
  const finalText = translation.trim()
  if (!finalText) {
    throw new Error(`${INVALID_RESPONSE_MESSAGE} raw: ${raw.slice(0, 300)}`)
  }
  setResult?.(finalText)
  return finalText
}
