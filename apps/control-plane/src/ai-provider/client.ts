import type { AiProviderTestFailure } from '@liwan/commercial-contracts'
import type { Preset } from './presets.js'

/** What the control plane needs to call a provider: its endpoint and the key to try. The key is never part of an error. */
export type ProbeTarget = { preset: Preset; baseUrl: string; apiKey: string | null; streamUsage: boolean }
/** What a test learned: the round trip and whether the reply carried token counts (the ones the service records as input and output). */
export type TestOutcome = { latencyMs: number; usageReported: boolean }
export type Fetcher = (url: string, init: RequestInit) => Promise<Response>

export class ProviderCallError extends Error {
  constructor(public code: AiProviderTestFailure) { super(code) }
}

const MODELS_TIMEOUT_MS = 15_000
const TEST_TIMEOUT_MS = 20_000
const MAX_MODELS = 500
const MAX_ERROR_BYTES = 4096
const ANTHROPIC_VERSION = '2023-06-01'
const PROBE_PROMPT = 'Reply with the single word: ok'

function headers(target: ProbeTarget, json: boolean): Record<string, string> {
  const base: Record<string, string> = json ? { 'content-type': 'application/json' } : {}
  if (!target.apiKey) return base
  return target.preset.dialect === 'anthropic'
    ? { ...base, 'x-api-key': target.apiKey, 'anthropic-version': ANTHROPIC_VERSION }
    : { ...base, authorization: `Bearer ${target.apiKey}` }
}

/** One provider request: no redirects (a redirect would carry the key to another host), a hard timeout, and failures reduced to a stable code. The fetcher is the guarded one (guarded-fetch.ts) except in tests. */
async function call(fetcher: Fetcher, url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  try {
    return await fetcher(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(timeoutMs) })
  } catch (error) {
    const name = (error as Error)?.name
    // The guard's own refusals (guarded-fetch.ts) keep their meaning; everything else about the network is reduced to a code too.
    throw new ProviderCallError(name === 'EndpointRefused' ? 'endpoint_refused' : name === 'BodyTooLarge' ? 'invalid_response' : name === 'TimeoutError' || name === 'AbortError' ? 'timeout' : 'unreachable')
  }
}

async function failureOf(response: Response, phase: 'models' | 'test'): Promise<ProviderCallError> {
  const { status } = response
  if (status === 401 || status === 403) return new ProviderCallError('unauthorized')
  if (status === 429) return new ProviderCallError('rate_limited')
  if (status >= 500) return new ProviderCallError('provider_error')
  if (phase === 'test' && (status === 404 || status === 400 || status === 422)) {
    const body = (await response.text().catch(() => '')).slice(0, MAX_ERROR_BYTES).toLowerCase()
    if (body.includes('stream_options') || body.includes('include_usage')) return new ProviderCallError('stream_usage_refused')
    return new ProviderCallError(status === 404 || body.includes('model') ? 'model_not_found' : 'bad_request')
  }
  return new ProviderCallError(phase === 'test' ? 'bad_request' : 'provider_error')
}

const stringsAt = (items: unknown[], pick: (item: Record<string, unknown>) => unknown): string[] =>
  items.flatMap(item => (item && typeof item === 'object' ? [pick(item as Record<string, unknown>)] : [])).filter((id): id is string => typeof id === 'string' && id.length > 0)

/** The model ids a provider offers, from its own models endpoint. */
export async function listModels(fetcher: Fetcher, target: ProbeTarget): Promise<string[]> {
  const { dialect } = target.preset
  const url = dialect === 'ollama' ? `${target.baseUrl}/api/tags` : dialect === 'anthropic' ? `${target.baseUrl}/models?limit=100` : `${target.baseUrl}/models`
  const response = await call(fetcher, url, { method: 'GET', headers: headers(target, false) }, MODELS_TIMEOUT_MS)
  if (!response.ok) throw await failureOf(response, 'models')
  let body: unknown
  try { body = await response.json() } catch { throw new ProviderCallError('invalid_response') }
  const record = body as { data?: unknown; models?: unknown }
  const entries = Array.isArray(body) ? body : dialect === 'ollama' ? record?.models : record?.data  // Together answers a bare array
  if (!Array.isArray(entries)) throw new ProviderCallError('invalid_response')
  const ids = stringsAt(entries, item => (dialect === 'ollama' ? item.name : item.id)).map(id => id.replace(/^models\//, ''))  // Gemini prefixes ids with models/
  return [...new Set(ids)].sort().slice(0, MAX_MODELS)
}

function completionRequest(target: ProbeTarget, model: string, capField: 'max_tokens' | 'max_completion_tokens'): { url: string; body: unknown } {
  const messages = [{ role: 'user', content: PROBE_PROMPT }]
  switch (target.preset.dialect) {
    case 'anthropic': return { url: `${target.baseUrl}/messages`, body: { model, max_tokens: 16, messages } }
    case 'ollama': return { url: `${target.baseUrl}/api/chat`, body: { model, messages, stream: false, options: { num_predict: 16 } } }
    // Streamed, and asking for the usage chunk exactly as the AI service does, so the test shows what the service will get.
    default: return { url: `${target.baseUrl}/chat/completions`, body: { model, messages, [capField]: 16, stream: true, ...(target.streamUsage ? { stream_options: { include_usage: true } } : {}) } }
  }
}

const isCount = (value: unknown): boolean => typeof value === 'number' && Number.isFinite(value)

/** The JSON objects of an event stream (`data: {...}` lines), or of a plain JSON reply from a server that ignored `stream`. */
function chunksOf(text: string): Record<string, unknown>[] {
  const chunks: unknown[] = []
  for (const line of text.split('\n')) {
    const data = line.trim().startsWith('data:') ? line.trim().slice(5).trim() : ''
    if (!data || data === '[DONE]') continue
    try { chunks.push(JSON.parse(data)) } catch { /* a keep-alive or comment line */ }
  }
  if (!chunks.length) { try { chunks.push(JSON.parse(text)) } catch { /* not JSON either: invalid_response below */ } }
  return chunks.filter((chunk): chunk is Record<string, unknown> => Boolean(chunk) && typeof chunk === 'object' && !Array.isArray(chunk))
}

function reportsUsage(dialect: ProbeTarget['preset']['dialect'], chunks: Record<string, unknown>[]): boolean {
  if (dialect === 'ollama') return chunks.some(chunk => isCount(chunk.prompt_eval_count) && isCount(chunk.eval_count))
  const usageOf = (chunk: Record<string, unknown>) => chunk.usage as Record<string, unknown> | null | undefined
  if (dialect === 'anthropic') return chunks.some(chunk => isCount(usageOf(chunk)?.input_tokens) && isCount(usageOf(chunk)?.output_tokens))
  return chunks.some(chunk => isCount(usageOf(chunk)?.prompt_tokens) && isCount(usageOf(chunk)?.completion_tokens))
}

/** One minimal completion; resolves with the round trip and whether the reply carried token counts, or throws a ProviderCallError. */
export async function testCompletion(fetcher: Fetcher, target: ProbeTarget, model: string, now: () => number = Date.now): Promise<TestOutcome> {
  const started = now()
  let response: Response | undefined
  for (const capField of ['max_tokens', 'max_completion_tokens'] as const) {
    const { url, body } = completionRequest(target, model, capField)
    response = await call(fetcher, url, { method: 'POST', headers: headers(target, true), body: JSON.stringify(body) }, TEST_TIMEOUT_MS)
    if (response.status !== 400 || target.preset.dialect !== 'openai') break
    // Newer OpenAI models refuse max_tokens; ask once more the way they want it.
    if (!(await response.clone().text().catch(() => '')).includes('max_completion_tokens')) break
  }
  if (!response!.ok) throw await failureOf(response!, 'test')
  const chunks = chunksOf(await response!.text().catch(() => ''))
  if (!chunks.length) throw new ProviderCallError('invalid_response')
  return { latencyMs: now() - started, usageReported: reportsUsage(target.preset.dialect, chunks) }
}
