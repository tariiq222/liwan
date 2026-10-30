import http from 'node:http'
import https from 'node:https'
import { createError, getHeader, type H3Event } from 'h3'
import { createBodyAdmission, createResponseAdmission, HEAVY_CREDITS, readBodyBytes } from './bufferAdmission.mjs'
import { tenantUpstreamHeaders } from './tenantRequest'
import { HEAVY_TIMEOUT, UPSTREAM_TIMEOUT } from './upstreamDeadlines'

const MAX_REQUEST = 16 * 1024 * 1024
// Public MFA carries a single code field; both entry points share this wire budget.
export const MAX_PUBLIC_MFA_BODY = 1024
/** A provider webhook delivery (the inbox WhatsApp hook) is a small JSON envelope; media arrives by reference. */
export const MAX_PUBLIC_HOOK_BODY = 1024 * 1024
const WHATSAPP_HOOK_PATH = '/api/v1/inbox/hooks/whatsapp'
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
      const reader = result.body.getReader()
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
      return new Response(Buffer.concat(chunks), { status: result.status, statusText: result.statusText, headers: result.headers }) as T
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
      for (const name of ['host', 'content-length', ...hop, ...nominated(getHeader(event, 'connection'))]) headers.delete(name)
      const response = await fetch(new URL(path, base), { method: options.method, body: options.body ? new Uint8Array(options.body) : undefined, headers, signal, redirect: 'manual' })
      if (response.status >= 300 && response.status < 400 && response.status !== 304) { await response.body?.cancel(); throw failure() }
      const forwarded = new Headers(response.headers)
      for (const name of [...hop, ...nominated(response.headers.get('connection'))]) forwarded.delete(name)
      // Fetch decodes payloads but leaves representation headers unchanged.
      // HEAD/304 have no decoded body, so their representation metadata remains valid.
      if (response.body) { forwarded.delete('content-encoding'); forwarded.delete('content-length') }
      return new Response(response.body, { status: response.status, statusText: response.statusText, headers: forwarded })
    }, event, options.heavy)
  } catch { throw failure() }
}

/** Server-only, fixed operator configuration. No request-controlled destination or redirects.
 * Bounded buffering deliberately replaces streaming: max16MiB request/32MiB response,
 * 15s total deadline (the heavy budget's deadline for an allowlisted heavy route). This supports current JSON attachments, not unbounded exports.
 * By default the call is destroyed when the browser disconnects; `ignoreClientClose` is only for a step that must finish
 * once begun (a claimed AI write) and keeps just the deadline and the optional `signal`. */
export async function tenantTransport(event: H3Event, configuredUpstream: string, path: string, options: { method?: string; body?: string | Buffer; headers?: Record<string, string>; signal?: AbortSignal; ignoreClientClose?: boolean; heavy?: HeavyBudget } = {}): Promise<Response> {
  const binding = tenantUpstreamHeaders(event)
  if (!binding.host) throw failure()
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
  const signature = path.split('?')[0] === WHATSAPP_HOOK_PATH ? getHeader(event, 'x-hub-signature-256') : undefined
  if (signature) headers['x-hub-signature-256'] = signature
  const cookie = options.headers?.cookie ?? getHeader(event, 'cookie')
  if (cookie) headers.cookie = cookie
  if (body) headers['content-length'] = String(Buffer.byteLength(body))
  const cancellation = clientCancellation(event, options)
  let releaseSlots: (() => void) | undefined
  try {
    releaseSlots = await acquireUpstream(cancellation.signal, options.heavy)
    // Cancellation can win after release grants this slot but before this continuation runs.
    if (cancellation.signal.aborted) throw failure()
    return await new Promise<Response>((resolve, reject) => {
    let settled = false
    const finish = (error?: Error, result?: Response) => {
      if (settled) return
      settled = true; clearTimeout(timer)
      cancellation.signal.removeEventListener('abort', abort)
      if (error) reject(error); else resolve(result!)
    }
    const request = (base.protocol === 'https:' ? https : http).request({ protocol: base.protocol, hostname: base.hostname, port: base.port, method: options.method ?? 'GET', path, headers, agent: false }, reply => {
      if ((reply.statusCode ?? 500) >= 300 && (reply.statusCode ?? 500) < 400 && reply.statusCode !== 304) {
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
        finish(undefined, new Response(options.method === 'HEAD' || [204, 205, 304].includes(status) ? null : Buffer.concat(chunks), { status, headers: responseHeaders }))
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
 * `heavy` isolates allowlisted long-running routes from ordinary session traffic. */
export type AdmissionScope = 'session' | 'public' | 'heavy'

// Heavy credits are held for the whole heavy run, so a waiter waits as long as that run may take.
const acquireBody = { session: createBodyAdmission('session'), public: createBodyAdmission('public'), heavy: createBodyAdmission('heavy', HEAVY_TIMEOUT) }

/** Keep memory credit while reading, waiting for upstream admission and forwarding. */
export async function withTenantBody<T>(event: H3Event, scope: AdmissionScope, run: () => Promise<T>): Promise<T> {
  let releaseBody: (() => void) | undefined
  try {
    releaseBody = await acquireBody[scope](event.node.req, event.node.res)
    return await run()
  } catch (error) { throw createError(error as Error) } finally { releaseBody?.() }
}

const responseAdmission = { session: createResponseAdmission('session'), public: createResponseAdmission('public'), heavy: createResponseAdmission('heavy', HEAVY_TIMEOUT) }

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
