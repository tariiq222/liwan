import http from 'node:http'
import https from 'node:https'
import { createError, getHeader, type H3Event } from 'h3'
import { createBodyAdmission, createResponseAdmission, HEAVY_CREDITS, readBodyBytes } from './bufferAdmission.mjs'
import { BEARER_KEY, isServiceAuthorizedRequest } from './serviceAuthorization'
import { tenantUpstreamHeaders } from './tenantRequest'
import { uiLocaleHeaders } from './uiLocale'
import { HEAVY_TIMEOUT, UPSTREAM_TIMEOUT } from './upstreamDeadlines'

const MAX_REQUEST = 16 * 1024 * 1024
// Public MFA carries a single code field; both entry points share this wire budget.
export const MAX_PUBLIC_MFA_BODY = 1024
/** A provider webhook delivery (an inbox hook) is a small JSON envelope; media arrives by reference. */
export const MAX_PUBLIC_HOOK_BODY = 1024 * 1024
/** Each inbox hook path and the one header carrying the provider's signature over the raw body; Odoo verifies it. */
export const HOOK_SIGNATURE_HEADERS: ReadonlyMap<string, string> = new Map([
  ['/api/v1/inbox/hooks/whatsapp', 'x-hub-signature-256'],
  ['/api/v1/inbox/hooks/tiktok', 'tiktok-signature'],
])
/** The provider OAuth callback finishes the connection and answers with an in-app redirect the browser must
 * follow. It is the only upstream 3xx that reaches the browser: Odoo builds it locally (`request.redirect`
 * with `local=True`), so its location is a path on this app, never another origin. */
export const CALLBACK_REDIRECT_PATHS: ReadonlySet<string> = new Set(['/api/v1/inbox/tiktok/callback'])
/** Where a callback redirect may point: the inbox settings pages that show the channel it connected. */
export const CALLBACK_REDIRECT_PREFIX = '/settings/apps/inbox'
const CALLBACK_REDIRECT_STATUSES: ReadonlySet<number> = new Set([302, 303])
// The origin a location is resolved against to normalize `..` and `//`; it must survive as the origin.
const LOCAL_ORIGIN = 'https://local.invalid'
// A path-only location: backslash and controls never name a local route, and are refused rather than cleaned.
const UNSAFE_LOCATION = /[\\\u0000-\u001f\u007f]/

/** Whether this response is the callback's own in-app redirect, which the browser follows as sent.
 * Every other 3xx (and a callback redirect pointing anywhere but the inbox settings pages) stays a failure,
 * so an upstream can never bounce the browser to another origin or to an arbitrary route. The location is
 * resolved first, so `..` and `//` cannot walk it out of the settings pages. */
export function isCallbackRedirect(path: string, status: number, location: string | null | undefined): boolean {
  if (!CALLBACK_REDIRECT_PATHS.has(path.split('?')[0] ?? path)) return false
  if (!CALLBACK_REDIRECT_STATUSES.has(status)) return false
  const target = location ?? ''
  if (!target.startsWith('/') || UNSAFE_LOCATION.test(target)) return false
  let resolved: URL
  try { resolved = new URL(target, LOCAL_ORIGIN) } catch { return false }
  if (resolved.origin !== LOCAL_ORIGIN) return false
  if (!resolved.pathname.startsWith(CALLBACK_REDIRECT_PREFIX)) return false
  const boundary = resolved.pathname.charAt(CALLBACK_REDIRECT_PREFIX.length)
  return !boundary || boundary === '/'
}
const MAX_RESPONSE = 32 * 1024 * 1024
/** Admission gate to the fixed operator upstreams. Odoo serves one request per worker process,
 * and an idle keep-alive connection would pin a worker, so each request uses its own connection
 * and at most UPSTREAM_MAX_CONCURRENCY requests are in flight at once. Excess requests queue
 * here instead of opening connections the kernel drops once the listen backlog fills. */
const configuredConcurrency = Number(process.env.NUXT_ODOO_MAX_CONCURRENCY)
const UPSTREAM_MAX_CONCURRENCY = Number.isFinite(configuredConcurrency) && configuredConcurrency > 0 ? Math.floor(configuredConcurrency) : 32
// Operator-owned memory bound: at most two default-sized batches may wait.
// Keep this fixed even when the operator raises upstream concurrency.
const UPSTREAM_MAX_QUEUED = 64
// Heavy writes (bulk posting, payroll compute) run one at a time so Odoo never holds several long transactions.
const HEAVY_WRITE_CONCURRENCY = 1
// Heavy credits bound how many heavy writes exist at once (one running, the rest waiting here),
// so a larger queue could never fill.
const HEAVY_WRITE_MAX_QUEUED = HEAVY_CREDITS - HEAVY_WRITE_CONCURRENCY

/** Budget of an allowlisted heavy route. `timeoutMs` is the admitted deadline and also the longest the
 * request waits for the write gate; `write` selects that gate (heavy reads run concurrently). */
export type HeavyBudget = { timeoutMs: number; write: boolean }

/** Bounded FIFO admission gate. A released slot is handed directly to the next waiter, so the
 * in-flight count never drifts; a waiter that times out or is cancelled removes itself first. */
function createGate(limit: number, maxQueued: number) {
  let inFlight = 0
  const waiters: Array<() => void> = []
  function acquire(signal: AbortSignal | undefined, waitMs: number): Promise<() => void> {
    if (signal?.aborted) return Promise.reject(failure())
    if (inFlight < limit) { inFlight++; return Promise.resolve(release) }
    if (waiters.length >= maxQueued) return Promise.reject(failure())
    return new Promise<() => void>((resolve, reject) => {
      const cleanup = () => { clearTimeout(timer); signal?.removeEventListener('abort', cancel) }
      const cancel = () => {
        const index = waiters.indexOf(resume)
        if (index >= 0) waiters.splice(index, 1)
        cleanup()
        reject(failure())
      }
      const timer = setTimeout(cancel, waitMs)
      const resume = () => { cleanup(); resolve(release) }
      waiters.push(resume)
      signal?.addEventListener('abort', cancel, { once: true })
    })
  }
  function release(): void {
    const next = waiters.shift()
    if (next) next(); else inFlight--
  }
  return { acquire, release }
}

const upstreamGate = createGate(UPSTREAM_MAX_CONCURRENCY, UPSTREAM_MAX_QUEUED)
const heavyWriteGate = createGate(HEAVY_WRITE_CONCURRENCY, HEAVY_WRITE_MAX_QUEUED)

/** Admit one upstream request and return the function that gives its capacity back. A heavy write takes
 * the write gate first, then an ordinary slot, so the global limit still applies to it.
 * A heavy read takes only an ordinary slot: concurrent heavy reads may occupy both of Odoo's workers, so
 * the "keep one worker free" guarantee holds for writes only (owner decision); the heavy credit pool and
 * the 32-slot gate are what bound them. */
function acquireUpstream(signal: AbortSignal, heavy: HeavyBudget | undefined): Promise<() => void> {
  return heavy?.write ? acquireHeavyWrite(signal, heavy.timeoutMs) : upstreamGate.acquire(signal, UPSTREAM_TIMEOUT)
}

async function acquireHeavyWrite(signal: AbortSignal, waitMs: number): Promise<() => void> {
  const releaseWrite = await heavyWriteGate.acquire(signal, waitMs)
  try {
    const releaseUpstream = await upstreamGate.acquire(signal, UPSTREAM_TIMEOUT)
    return () => { releaseUpstream(); releaseWrite() }
  } catch (error) { releaseWrite(); throw error }
}

/** Bind cancellation before admission so a disconnected request never starts later. */
function clientCancellation(event?: H3Event, options: { signal?: AbortSignal; ignoreClientClose?: boolean } = {}) {
  const controller = new AbortController()
  const cancel = () => controller.abort()
  const disconnected = () => { if (!event?.node.res.writableEnded) cancel() }
  if (event && !options.ignoreClientClose) {
    event.node.req.once('aborted', cancel)
    event.node.res.once('close', disconnected)
    if (event.node.req.aborted || (event.node.res.destroyed && !event.node.res.writableEnded)) cancel()
  }
  if (options.signal?.aborted) cancel(); else options.signal?.addEventListener('abort', cancel, { once: true })
  return {
    signal: controller.signal,
    cancel,
    dispose() {
      event?.node.req.removeListener('aborted', cancel)
      event?.node.res.removeListener('close', disconnected)
      options.signal?.removeEventListener('abort', cancel)
    },
  }
}

/** Read a response body under the transport's single response cap. A body over the cap
 * cancels its reader and fails the whole answer the same way an oversized success body does. */
async function boundedResponseBody(body: ReadableStream<Uint8Array>): Promise<Buffer<ArrayBuffer>> {
  const reader = body.getReader()
  const chunks: Uint8Array[] = []
  let bytes = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      bytes += value.byteLength
      if (bytes > MAX_RESPONSE) {
        await reader.cancel()
        throw failure()
      }
      chunks.push(value)
    }
  } finally { reader.releaseLock() }
  return Buffer.concat(chunks)
}

/** Hold one upstream slot, with caller cancellation and a 15s admitted deadline
 * (the heavy budget's deadline, and write gate for a heavy write, on an allowlisted heavy route). */
export async function withUpstreamSlot<T>(run: (signal: AbortSignal) => Promise<T>, event?: H3Event, heavy?: HeavyBudget): Promise<T> {
  const cancellation = clientCancellation(event)
  let releaseSlots: (() => void) | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    releaseSlots = await acquireUpstream(cancellation.signal, heavy)
    if (cancellation.signal.aborted) throw failure()
    timer = setTimeout(cancellation.cancel, heavy?.timeoutMs ?? UPSTREAM_TIMEOUT)
    // Await native cancellation before releasing capacity; a Promise.race would
    // let an upstream operation outlive its slot if it ignored the deadline.
    const result = await run(cancellation.signal)
    // Native fetch resolves on headers. Auth handlers consume its body after
    // this wrapper returns, so finish buffering here while the deadline and
    // admission slot still own the receiving socket.
    if (result instanceof Response && result.body) {
      return new Response(await boundedResponseBody(result.body), { status: result.status, statusText: result.statusText, headers: result.headers }) as T
    }
    return result
  } finally {
    clearTimeout(timer)
    cancellation.dispose()
    releaseSlots?.()
  }
}
const failure = () => createError({ statusCode: 502, message: 'tenant_upstream_unavailable', data: { code: 'tenant_upstream_unavailable', message: 'The upstream service is temporarily unavailable.' } })
const payloadTooLarge = () => createError({ statusCode: 413, message: 'payload_too_large', data: { code: 'payload_too_large', message: 'The request body exceeds the allowed size.' } })

/** The contract envelope's own keys: anything else in an error body came from the engine, not LiwanOS. */
const LIWAN_ERROR_FIELDS = new Set(['code', 'message', 'field', 'details'])
const GENERIC_ERROR_MESSAGE = 'An unexpected error occurred'
/** The generic refusal for a status: only the class of the failure is kept, never what caused it. */
function genericError(status: number): { code: string; message: string } {
  const code = status === 401 ? 'unauthorized'
    : status === 403 ? 'forbidden'
      : status === 404 ? 'not_found'
        : status === 409 ? 'conflict'
          : status === 429 ? 'rate_limited'
            : status >= 500 ? 'internal' : 'invalid'
  return { code, message: GENERIC_ERROR_MESSAGE }
}

function isLiwanError(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  return typeof record.code === 'string' && typeof record.message === 'string'
    && Object.keys(record).every(key => LIWAN_ERROR_FIELDS.has(key))
    && (record.field === undefined || typeof record.field === 'string')
    && (record.details === undefined || (!!record.details && typeof record.details === 'object' && !Array.isArray(record.details)))
}

/** Keep only a contract error body. Odoo serializes an uncaught exception as
 * `{name, message, arguments, context, debug}` with the whole traceback, so an error answer this BFF cannot
 * verify as the envelope becomes the generic refusal and the status is kept. The body is never inspected for
 * the fields it holds: an answer outside the contract is replaced whole, whatever it carries. */
function contractErrorBody(status: number, path: string, headers: Headers, body: Buffer): Buffer {
  if (status < 400 || !body.length || !path.startsWith('/api/v1/')) return body
  let parsed: unknown
  try { parsed = JSON.parse(body.toString('utf8')) } catch { parsed = undefined }
  if (isLiwanError(parsed)) return body
  // Server-side evidence that the engine answered outside the contract: the route and the status only, never
  // the body it wrote (a serialized exception can carry query values).
  console.error(`[liwan-bff] non-contract upstream error body: ${status} ${path.split('?')[0]}`)
  const replacement = Buffer.from(JSON.stringify(genericError(status)))
  headers.set('content-type', 'application/json')
  if (headers.has('content-length')) headers.set('content-length', String(replacement.length))
  headers.delete('content-encoding')
  // The entity changed, so its validator is no longer true.
  headers.delete('etag')
  return replacement
}

/** Rewrite one upstream answer: an error body the engine wrote itself becomes the contract refusal.
 * Every status, header and byte of a successful or an already-contract answer is preserved.
 * The body is read through the same bounded reader as a success answer, so a non-contract error
 * body can never be buffered beyond the response cap before its envelope is checked. */
async function contractAnswer(response: Response, path: string): Promise<Response> {
  if (response.status < 400 || !response.body) return response
  const headers = new Headers(response.headers)
  const served = contractErrorBody(response.status, path, headers, await boundedResponseBody(response.body))
  return new Response(new Uint8Array(served), { status: response.status, statusText: response.statusText, headers })
}

/** Share the same fixed operator destination/path validation in both transport modes. */
function operatorUpstream(configuredUpstream: string, path: string): URL {
  let base: URL
  try { base = new URL(configuredUpstream) } catch { throw failure() }
  if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password || base.pathname !== '/' || base.search || base.hash ||
      !/^\/(?:api\/v1\/|web\/session\/(?:authenticate|destroy)(?:$|\?))/.test(path) || path.startsWith('//') || /[\\\r\n#]/.test(path) || new URL(path, base).pathname !== path.split('?')[0]) throw failure()
  return base
}

/** Legacy dedicated has no binding envelope. Keep its selected headers but use
 * the existing admitted Response reader, size cap and native cancellation.
 */
export async function legacyTenantResponse(event: H3Event, configuredUpstream: string, path: string, options: { method?: string; body?: Buffer; headers: Record<string, string>; heavy?: HeavyBudget }): Promise<Response> {
  if ((process.env.LIWAN_TENANCY_MODE ?? 'dedicated') !== 'dedicated' || process.env.LIWAN_RELEASE_ROUTES_DIR) throw failure()
  const base = operatorUpstream(configuredUpstream, path)
  if (options.body && Buffer.byteLength(options.body) > MAX_REQUEST) throw payloadTooLarge()
  try {
    return await withUpstreamSlot(async signal => {
      const headers = new Headers(options.headers)
      const hop = ['connection', 'keep-alive', 'proxy-connection', 'proxy-authenticate', 'proxy-authorization', 'te', 'trailer', 'transfer-encoding', 'upgrade']
      const nominated = (value: string | null | undefined) => (value ?? '').toLowerCase().split(',').map(name => name.trim()).filter(Boolean)
      // The browser's own credentials header never reaches Odoo on this path: h3's proxy headers keep it, and the one request
      // allowed to carry a key (the AI usage report) is built by the server and never goes through here.
      for (const name of ['host', 'content-length', 'authorization', ...hop, ...nominated(getHeader(event, 'connection'))]) headers.delete(name)
      const response = await fetch(new URL(path, base), { method: options.method, body: options.body ? new Uint8Array(options.body) : undefined, headers, signal, redirect: 'manual' })
      if (response.status >= 300 && response.status < 400 && response.status !== 304 && !isCallbackRedirect(path, response.status, response.headers.get('location'))) { await response.body?.cancel(); throw failure() }
      const forwarded = new Headers(response.headers)
      for (const name of [...hop, ...nominated(response.headers.get('connection'))]) forwarded.delete(name)
      // Fetch decodes payloads but leaves representation headers unchanged.
      // HEAD/304 have no decoded body, so their representation metadata remains valid.
      if (response.body) { forwarded.delete('content-encoding'); forwarded.delete('content-length') }
      const plain = new Response(response.body, { status: response.status, statusText: response.statusText, headers: forwarded })
      return contractAnswer(plain, path)
    }, event, options.heavy)
  } catch { throw failure() }
}

/** Server-only, fixed operator configuration. No request-controlled destination or redirects.
 * Bounded buffering deliberately replaces streaming: max16MiB request/32MiB response,
 * 15s total deadline (the heavy budget's deadline for an allowlisted heavy route). This supports current JSON attachments, not unbounded exports.
 * By default the call is destroyed when the browser disconnects; `ignoreClientClose` is only for a step that must finish
 * once begun (a claimed AI write) and keeps just the deadline and the optional `signal`.
 * `authorization` is the server-held credential of the one request allowed to carry it (the AI usage report): any other
 * method or path is refused outright, so a caller cannot widen where the key goes. A browser's own `Authorization` header
 * is never read here: only this explicit option reaches the upstream. */
export async function tenantTransport(event: H3Event, configuredUpstream: string, path: string, options: { method?: string; body?: string | Buffer; headers?: Record<string, string>; authorization?: string; signal?: AbortSignal; ignoreClientClose?: boolean; heavy?: HeavyBudget } = {}): Promise<Response> {
  const binding = tenantUpstreamHeaders(event)
  if (!binding.host) throw failure()
  if (options.authorization !== undefined && (!isServiceAuthorizedRequest(options.method, path) || !BEARER_KEY.test(options.authorization))) throw failure()
  const base = operatorUpstream(configuredUpstream, path)
  const body = options.body
  if (body && Buffer.byteLength(body) > MAX_REQUEST) throw payloadTooLarge()
  const headers: Record<string, string> = { ...binding }
  // Only explicitly selected application headers, never hop-by-hop or client authority.
  // The two expected-context headers state the identity a finance setup screen was read for; Odoo compares
  // them with the authenticated session, so they never select a company and never grant access.
  for (const name of ['content-type', 'accept', 'if-none-match', 'if-modified-since', 'range',
    'x-liwan-expected-user-id', 'x-liwan-expected-company-id']) {
    const value = options.headers?.[name] ?? getHeader(event, name)
    if (value) headers[name] = value
  }
  // A provider webhook carries its HMAC signature over the raw body; Odoo verifies it, so it passes to that route only.
  const signatureHeader = HOOK_SIGNATURE_HEADERS.get(path.split('?')[0] ?? path)
  const signature = signatureHeader ? getHeader(event, signatureHeader) : undefined
  if (signatureHeader && signature) headers[signatureHeader] = signature
  // A service-authorized request is the server's own call: the user's session cookie must not ride along with the key.
  const cookie = options.authorization !== undefined ? undefined : (options.headers?.cookie ?? getHeader(event, 'cookie'))
  if (cookie) headers.cookie = cookie
  if (options.authorization !== undefined) headers.authorization = options.authorization
  Object.assign(headers, uiLocaleHeaders(event))
  if (body) headers['content-length'] = String(Buffer.byteLength(body))
  const cancellation = clientCancellation(event, options)
  let releaseSlots: (() => void) | undefined
  try {
    releaseSlots = await acquireUpstream(cancellation.signal, options.heavy)
    // Cancellation can win after release grants this slot but before this continuation runs.
    if (cancellation.signal.aborted) throw failure()
    // Admission may have waited across a registry disable/revision publication.
    // Verify again at actual dispatch, rebuilding the trusted release envelope.
    Object.assign(headers, tenantUpstreamHeaders(event))
    return await new Promise<Response>((resolve, reject) => {
    let settled = false
    const finish = (error?: Error, result?: Response) => {
      if (settled) return
      settled = true; clearTimeout(timer)
      cancellation.signal.removeEventListener('abort', abort)
      if (error) reject(error); else resolve(result!)
    }
    const request = (base.protocol === 'https:' ? https : http).request({ protocol: base.protocol, hostname: base.hostname, port: base.port, method: options.method ?? 'GET', path, headers, agent: false }, reply => {
      if ((reply.statusCode ?? 500) >= 300 && (reply.statusCode ?? 500) < 400 && reply.statusCode !== 304 && !isCallbackRedirect(path, reply.statusCode ?? 500, reply.headers.location)) {
        reply.destroy(); request.destroy(); finish(failure()); return
      }
      const chunks: Buffer[] = []; let bytes = 0
      reply.on('data', chunk => {
        bytes += chunk.length
        if (bytes > MAX_RESPONSE) { reply.destroy(); request.destroy(); finish(failure()) } else chunks.push(chunk)
      })
      reply.on('error', () => finish(failure()))
      reply.on('end', () => {
        const responseHeaders = new Headers()
        const hop = new Set(['connection', 'keep-alive', 'transfer-encoding', 'upgrade', 'proxy-authenticate', 'proxy-authorization', 'te', 'trailer', ...(reply.headers.connection ?? '').toLowerCase().split(',').map(v => v.trim())])
        for (const [name, value] of Object.entries(reply.headers)) {
          if (hop.has(name) || value === undefined) continue
          for (const item of Array.isArray(value) ? value : [value]) responseHeaders.append(name, item)
        }
        const status = reply.statusCode ?? 502
        const bodiless = options.method === 'HEAD' || [204, 205, 304].includes(status)
        const served = bodiless ? null : contractErrorBody(status, path, responseHeaders, Buffer.concat(chunks))
        finish(undefined, new Response(served && new Uint8Array(served), { status, headers: responseHeaders }))
      })
    })
    const abort = () => { request.destroy(); finish(failure()) }
    const timer = setTimeout(abort, options.heavy?.timeoutMs ?? UPSTREAM_TIMEOUT)
    cancellation.signal.addEventListener('abort', abort, { once: true })
    request.on('error', () => finish(failure()))
    request.end(body)
    })
  } finally {
    cancellation.dispose()
    releaseSlots?.()
  }
}

/** `public` is the separate small pool for requests that skip session admission;
 * `booking` isolates the invited requester's booking-link routes from sign-in and MFA;
 * `heavy` isolates allowlisted long-running routes from ordinary session traffic. */
export type AdmissionScope = 'session' | 'public' | 'booking' | 'heavy'

// Heavy credits are held for the whole heavy run, so a waiter waits as long as that run may take.
const acquireBody = { session: createBodyAdmission('session'), public: createBodyAdmission('public'), booking: createBodyAdmission('booking'), heavy: createBodyAdmission('heavy', HEAVY_TIMEOUT) }

/** Keep memory credit while reading, waiting for upstream admission and forwarding. */
export async function withTenantBody<T>(event: H3Event, scope: AdmissionScope, run: () => Promise<T>): Promise<T> {
  let releaseBody: (() => void) | undefined
  try {
    releaseBody = await acquireBody[scope](event.node.req, event.node.res)
    return await run()
  } catch (error) { throw createError(error as Error) } finally { releaseBody?.() }
}

const responseAdmission = { session: createResponseAdmission('session'), public: createResponseAdmission('public'), booking: createResponseAdmission('booking'), heavy: createResponseAdmission('heavy', HEAVY_TIMEOUT) }

/** Own response capacity until native work and the downstream HTTP output settle. */
export async function withTenantResponse<T>(event: H3Event, scope: AdmissionScope, run: () => Promise<T>): Promise<T> {
  try { return await responseAdmission[scope](event.node.req, event.node.res, run) }
  catch (error) { throw createError(error as Error) }
}

export async function boundedTenantBody(event: H3Event, maxBytes = MAX_REQUEST): Promise<Buffer | undefined> {
  if (['GET', 'HEAD'].includes(event.method)) return undefined
  return readBodyBytes(event.node.req, event.node.res, maxBytes)
}

/** Read a bounded auth JSON object once, before parsing or upstream admission. */
export async function boundedTenantJson<T extends Record<string, unknown>>(event: H3Event, maxBytes: number): Promise<T> {
  const body = await boundedTenantBody(event, maxBytes)
  try {
    const value = JSON.parse(body?.toString('utf8') ?? '')
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('invalid_json_object')
    return value as T
  } catch {
    throw createError({ statusCode: 400, data: { code: 'invalid_json', message: 'The request body must be a valid JSON object.' } })
  }
}
