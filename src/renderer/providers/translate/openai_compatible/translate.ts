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

export type OpenAICompatibleConfig = Record<string, unknown> & {
  promptList?: PromptItem[]
  model?: string
  requestPath?: string
  apiKey?: string
  stream?: boolean
  temperature?: string
  maxTokens?: string
  requestArguments?: string
}

export type SetResult = ((value: string) => void) | undefined

export interface OpenAICompatibleTranslateOptions {
  config?: OpenAICompatibleConfig
  setResult?: SetResult
  detect?: string
}

export interface OpenAICompatibleRequestBody {
  kind: 'json'
  data: unknown
}

export interface OpenAICompatibleRequestInit {
  method: 'POST'
  headers: Record<string, string>
  body: OpenAICompatibleRequestBody
  responseType?: 2
  timeoutMs?: number
}

export type OpenAICompatibleResponse = ProviderResponse<{ text: () => Promise<string> }>

export type OpenAICompatibleRequest = (
  url: string,
  init: OpenAICompatibleRequestInit,
) => Promise<OpenAICompatibleResponse>

export interface OpenAICompatibleDependencies {
  request: OpenAICompatibleRequest
}

interface OpenAIChatMessage {
  role: string
  content: string
}

interface OpenAIChatRequestBody {
  model: string
  messages: OpenAIChatMessage[]
  stream: boolean
  temperature?: number
  max_tokens?: number
}

const INVALID_RESPONSE_MESSAGE = 'The model returned an empty translation response.'

export const DEFAULT_OPENAI_COMPATIBLE_BASE_URL = 'https://api.openai.com/v1'

export function normalizeOpenAICompatibleBaseUrl(value: string | undefined): string {
  const text = String(value ?? '').trim()
  const withScheme = /^https?:\/\//i.test(text) ? text : `https://${text}`
  return withScheme.replace(/\/+$/, '').replace(/\/chat\/completions\/?$/i, '')
}

export function resolveOpenAICompatibleChatUrl(value: string | undefined): string {
  const base = normalizeOpenAICompatibleBaseUrl(value)
  return /\/v\d+$/i.test(base) ? `${base}/chat/completions` : `${base}/v1/chat/completions`
}

export function buildPrompt(
  promptList: PromptItem[],
  text: string,
  from: string,
  to: string,
  detect?: string,
): PromptItem[] {
  const detectedLanguage = detect ? ((Language as Record<string, string>)[detect] ?? detect) : ''
  return promptList.map((item) => ({
    ...item,
    content: item.content
      .replaceAll('$text', text)
      .replaceAll('$from', from)
      .replaceAll('$to', to)
      .replaceAll('$detect', detectedLanguage),
  }))
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

function parseOptionalInteger(value: unknown, fieldName: string): number | undefined {
  const parsed = parseOptionalFloat(value, fieldName)
  if (parsed === undefined) {
    return undefined
  }
  if (!Number.isInteger(parsed)) {
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
    // Fall through: non-JSON input is reported at request build time.
  }
  throw new Error('Extra request arguments must be a JSON object.')
}

function sseText(raw: string): string {
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
    const choice = asRecord(asRecord(event)?.choices)?.[0]
    const choiceRecord = asRecord(choice)
    const deltaContent = asRecord(choiceRecord?.delta)?.content
    if (typeof deltaContent === 'string') {
      text += deltaContent
      continue
    }
    const messageContent = asRecord(choiceRecord?.message)?.content
    if (typeof messageContent === 'string') {
      text += messageContent
    }
  }
  return text
}

function parseJsonOrText(raw: string): unknown {
  try {
    return JSON.parse(raw)
  } catch {
    return undefined
  }
}

function contentFromResponse(data: unknown): string {
  const choice = asRecord(asRecord(data)?.choices)?.[0]
  const content = asRecord(choice)?.content
  if (typeof content === 'string') {
    return content
  }
  return ''
}

export async function translateOpenAICompatible(
  text: string,
  from: string,
  to: string,
  options: OpenAICompatibleTranslateOptions = {},
  dependencies: OpenAICompatibleDependencies,
): Promise<string> {
  const { config = {}, setResult, detect } = options
  const model = String(config.model ?? '').trim()
  if (!model) {
    throw new Error('Please select or enter a model.')
  }
  const apiKey = String(config.apiKey ?? '').trim()
  if (!apiKey) {
    throw new Error('Please configure the API key.')
  }

  const url = resolveOpenAICompatibleChatUrl(config.requestPath)
  const promptList = buildPrompt(config.promptList ?? [], text, from, to, detect)
  if (promptList.length === 0) {
    throw new Error('The prompt list must not be empty.')
  }

  const extra = parseExtraRequestArguments(config.requestArguments)
  const requestBody: OpenAIChatRequestBody = {
    model,
    messages: promptList.map((item) => ({ role: item.role, content: item.content })),
    stream: config.stream === true,
    ...extra,
  }
  const temperature = parseOptionalFloat(config.temperature, 'temperature')
  const maxTokens = parseOptionalInteger(config.maxTokens, 'max_tokens')
  if (temperature !== undefined) {
    requestBody.temperature = temperature
  }
  if (maxTokens !== undefined) {
    requestBody.max_tokens = maxTokens
  }

  const init: OpenAICompatibleRequestInit = {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: { kind: 'json', data: requestBody },
    responseType: requestBody.stream ? 2 : undefined,
    timeoutMs: 120_000,
  }

  let response: OpenAICompatibleResponse
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
    translation = sseText(raw)
  } else {
    translation = contentFromResponse(parseJsonOrText(raw))
  }
  const finalText = translation.trim()
  if (!finalText) {
    throw new Error(`${INVALID_RESPONSE_MESSAGE} raw: ${raw.slice(0, 300)}`)
  }
  setResult?.(finalText)
  return finalText
}
