import { fetch, Body } from '@/renderer/lib/electron/http'

import {
  translateOpenAICompatible,
  type OpenAICompatibleRequest,
  type OpenAICompatibleTranslateOptions,
} from './translate'

const request: OpenAICompatibleRequest = async (url, init) =>
  fetch(url, {
    method: init.method,
    headers: init.headers,
    body: Body.json(init.body.data),
    responseType: init.responseType,
    timeoutMs: init.timeoutMs,
  })

export async function getModels(requestPath?: string, apiKey?: string) {
  const base = String(requestPath ?? '').trim() || 'https://api.openai.com/v1'
  const listUrl = /\/v\d+$/i.test(base.replace(/\/+$/, ''))
    ? `${base.replace(/\/+$/, '')}/models`
    : `${base.replace(/\/+$/, '')}/v1/models`
  const headers: Record<string, string> = {}
  const key = String(apiKey ?? '').trim()
  if (key) {
    headers.Authorization = `Bearer ${key}`
  }
  const res = await fetch<{ data?: { id?: string }[] }>(listUrl, { headers })
  if (res.ok) {
    const models = (res.data?.data ?? [])
      .map((item) => String(item?.id ?? '').trim())
      .filter(Boolean)
    return [...new Set(models)].sort((a, b) => a.localeCompare(b))
  }
  throw new Error(`Failed to list models: HTTP ${res.status}`)
}

export async function translate(
  text: string,
  from: string,
  to: string,
  options: OpenAICompatibleTranslateOptions = {},
) {
  return translateOpenAICompatible(text, from, to, options, { request })
}

export * from './Config'
export * from './info'
