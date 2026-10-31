import type { H3Event } from 'h3'
import { createError, getHeader } from 'h3'
import { joinURL, withQuery, type QueryObject } from 'ufo'
import { tenantTransport } from '../tenantTransport'
import { tenantUpstreamHeaders } from '../tenantRequest'
import { upstreamError } from './executor'
import { uiLocaleHeaders } from '../uiLocale'

export type Upstream = { status: number; body: unknown }
export type Owner = { tenant: string; user: string }

const AI_ABORT = Symbol('liwan-ai-abort')
const SERVICE_TIMEOUT_MS = 130000
const ODOO_TIMEOUT_MS = 15000
const MAX_SSE_BUFFER = 1024 * 1024
const AI_STATE_VERSION = '1'
export type ReleaseWritePermit = <T>(action: () => Promise<T>) => Promise<T>
type AiRelease = { releaseId: string; poolId: string; routeRevision: number; fence: number; aiUrl?: string; aiStateVersion?: string; aiMaintenance?: boolean }
const pinnedReleases = new WeakMap<H3Event, Readonly<AiRelease>>()
const acceptedClaims = new WeakMap<H3Event, Map<string, string>>()

/** Only trusted middleware, after tenant boundary verification, supplies this context. Never read browser routing headers. */
function releaseFor(event: H3Event, settlingClaim = false): Readonly<AiRelease> | undefined {
  if (!process.env.LIWAN_RELEASE_ROUTES_DIR) return undefined
  const current = event.context.liwanRelease as AiRelease | undefined
  if (current?.aiMaintenance && !settlingClaim) throw serviceUnavailable('the AI service is under maintenance')
  const pinned = pinnedReleases.get(event)
  if (pinned) return pinned
  if (!current || !current.releaseId || !current.poolId || !Number.isSafeInteger(current.routeRevision) || current.routeRevision < 0
    || !Number.isSafeInteger(current.fence) || current.fence < 0 || current.aiStateVersion !== AI_STATE_VERSION || !current.aiUrl) {
    throw serviceUnavailable('the AI release route is unavailable')
  }
  let url: URL
  try { url = new URL(current.aiUrl) } catch { throw serviceUnavailable('the AI release route is unavailable') }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw serviceUnavailable('the AI release route is unavailable')
  const snapshot = Object.freeze({ ...current })
  pinnedReleases.set(event, snapshot)
  return snapshot
}

/** The coordinator owns the durable lease and barrier check. The callback lasts through response consumption. */
export async function withReleaseWritePermit<T>(event: H3Event, action: () => Promise<T>): Promise<T> {
  if (!releaseFor(event)) return action()
  const permit = event.context.liwanReleaseWritePermit as ReleaseWritePermit | undefined
  if (typeof permit !== 'function') throw serviceUnavailable('the AI release write permit is unavailable')
  return permit(action)
}

/**
 * Aborts when the browser goes away before the response ended. `res.close` (not `req.close`, which Node fires once the request
 * body was read) is the real disconnect signal. Memoized per request.
 */
export function clientSignal(event: H3Event): AbortSignal {
  const holder = event.context as { [AI_ABORT]?: AbortController }
  if (!holder[AI_ABORT]) {
    const controller = new AbortController()
    event.node.res.once('close', () => { if (!event.node.res.writableEnded) controller.abort() })
    holder[AI_ABORT] = controller
  }
  return holder[AI_ABORT].signal
}

/** `undefined` follows the browser's abort; `null` shields a step that must finish once begun (a claimed write). */
export type SignalOption = AbortSignal | null | undefined
const withTimeout = (event: H3Event, ms: number, signal: SignalOption): AbortSignal =>
  AbortSignal.any([AbortSignal.timeout(ms), ...(signal === null ? [] : [signal ?? clientSignal(event)])])

/** Server-side log of a failure: the class name only, never a message that could carry Odoo or service details. */
export function logFailure(what: string, error: unknown): void {
  console.error(`[liwan-ai] ${what}: ${(error as object | null)?.constructor?.name ?? 'unknown'}`)
}

/** Throw an Odoo failure with its own status and structured code (flat body; `{error}` only as a fallback). */
export function forwardUpstream(upstream: Upstream): never {
  throw createError({ statusCode: upstream.status, data: upstreamError(upstream.body) ?? { code: 'http_error', message: `upstream status ${upstream.status}` } })
}

/** One Odoo call as the caller: the request cookie travels, nothing else is added. */
export async function odooJson(event: H3Event, method: 'GET' | 'POST' | 'PATCH', path: string, options: { query?: Record<string, unknown>; body?: unknown; signal?: SignalOption } = {}): Promise<Upstream> {
  const dispatch = async (): Promise<Upstream> => {
    const { odooUrl } = useRuntimeConfig(event)
    const cookie = getHeader(event, 'cookie')
    if (!cookie) throw createError({ statusCode: 401, data: { code: 'unauthorized', message: 'no session' } })
    const target = withQuery(path, (options.query ?? {}) as QueryObject)
    const headers: Record<string, string> = { cookie, accept: 'application/json', ...uiLocaleHeaders(event), ...(options.body !== undefined ? { 'content-type': 'application/json' } : {}) }
    const body = options.body !== undefined ? JSON.stringify(options.body) : undefined
    const tenantHeaders = tenantUpstreamHeaders(event)
    const response = Object.keys(tenantHeaders).length
      ? await tenantTransport(event, odooUrl, target, { method, body, headers, signal: options.signal ?? undefined, ignoreClientClose: options.signal === null })
      : await fetch(joinURL(odooUrl, target), { method, body, headers, redirect: 'error', signal: withTimeout(event, ODOO_TIMEOUT_MS, options.signal) })
    const text = await response.text()
    let parsed: unknown = text
    try { parsed = text ? JSON.parse(text) : null } catch { parsed = text }
    return { status: response.status, body: parsed }
  }
  return method === 'GET' ? dispatch() : withReleaseWritePermit(event, dispatch)
}

/** One call to the LiwanOS AI service. It gets no cookie and no bearer: the owner headers (plus the shared service token, when set) are all it sees. */
export async function serviceFetch(event: H3Event, method: 'GET' | 'POST' | 'PATCH', path: string, owner: Owner, body?: unknown, signal?: SignalOption): Promise<Response> {
  const config = useRuntimeConfig(event)
  const payload = body as { call_id?: string; result?: { decision?: string } } | undefined
  const claimPath = path.endsWith('/resume') ? path.slice(0, -7) + '/claim' : ''
  const settlingClaim = method === 'POST' && signal === null && !!claimPath && payload?.result?.decision === 'approved'
    && !!payload.call_id && acceptedClaims.get(event)?.get(claimPath) === payload.call_id
  const route = releaseFor(event, settlingClaim)
  const aiServiceUrl = route?.aiUrl ?? config.aiServiceUrl
  const aiServiceToken = config.aiServiceToken
  if (!aiServiceUrl) throw serviceUnavailable('the AI service is not configured')
  try {
    const response = await fetch(joinURL(aiServiceUrl, path), {
      method,
      headers: {
        'content-type': 'application/json', accept: 'text/event-stream, application/json', 'x-liwan-tenant': owner.tenant, 'x-liwan-user': owner.user,
        ...(aiServiceToken ? { 'x-liwan-service-token': aiServiceToken } : {}),
        ...(route ? { 'x-liwan-ai-state-version': route.aiStateVersion! } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: withTimeout(event, SERVICE_TIMEOUT_MS, signal),
      redirect: 'error',
    })
    if (response.ok && method === 'POST' && /^\/v1\/runs\/[^/]+\/claim$/.test(path) && payload?.call_id) {
      const claims = acceptedClaims.get(event) ?? new Map<string, string>()
      claims.set(path, payload.call_id)
      acceptedClaims.set(event, claims)
    }
    if (response.ok && settlingClaim) acceptedClaims.get(event)?.delete(claimPath)
    return response
  } catch {
    // Refused, reset or timed out: the raw exception text never reaches the browser.
    throw serviceUnavailable('the AI service is unavailable')
  }
}

function serviceUnavailable(message: string) {
  return createError({ statusCode: 503, data: { code: 'ai_unavailable', message } })
}

/** Parse an SSE body into `[event, data]` pairs as they arrive; the reader is cancelled when the consumer stops or the stream ends. */
export async function* readSse(response: Response): AsyncGenerator<[string, any]> {
  if (!response.ok || !response.body) {
    throw createError({ statusCode: response.status === 404 ? 404 : response.status === 409 ? 409 : 502, data: { code: response.status === 409 ? 'ai_conflict' : response.status === 404 ? 'not_found' : 'ai_upstream', message: `AI service status ${response.status}` } })
  }
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  // A trailing CR is held back until the next chunk shows whether it is half of a CRLF.
  let carriedCr = false
  const append = (text: string, final: boolean) => {
    let incoming = (carriedCr ? '\r' : '') + text
    carriedCr = !final && incoming.endsWith('\r')
    if (carriedCr) incoming = incoming.slice(0, -1)
    buffer += incoming.replace(/\r\n?/g, '\n')
  }
  try {
    for (let finished = false; !finished;) {
      let chunk: ReadableStreamReadResult<Uint8Array>
      try { chunk = await reader.read() } catch { throw serviceUnavailable('the AI service connection was lost') }
      if (chunk.done) { append(decoder.decode(), true); finished = true } else append(decoder.decode(chunk.value, { stream: true }), false)
      let index: number
      while ((index = buffer.indexOf('\n\n')) >= 0) {
        const parsed = parseSseBlock(buffer.slice(0, index))
        buffer = buffer.slice(index + 2)
        if (parsed) yield parsed
      }
      if (finished && buffer.trim()) {
        const parsed = parseSseBlock(buffer)
        buffer = ''
        if (parsed) yield parsed
      }
      if (buffer.length > MAX_SSE_BUFFER) throw createError({ statusCode: 502, data: { code: 'ai_upstream', message: 'AI service event too large' } })
    }
  } finally {
    await reader.cancel().catch(() => undefined)
  }
}

function parseSseBlock(block: string): [string, any] | null {
  let name: string | undefined
  const data: string[] = []
  for (const line of block.split('\n')) {
    if (line.startsWith(':')) continue
    const colon = line.indexOf(':')
    const field = colon < 0 ? line : line.slice(0, colon)
    const value = colon < 0 ? '' : line.slice(colon + 1).replace(/^ /, '')
    if (field === 'event') name = value
    else if (field === 'data') data.push(value)
  }
  if (!name || !data.length) return null
  try { return [name, JSON.parse(data.join('\n'))] } catch {
    throw createError({ statusCode: 502, data: { code: 'ai_upstream', message: 'AI service sent a malformed event' } })
  }
}
