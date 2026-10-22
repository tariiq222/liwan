import http from 'node:http'
import https from 'node:https'
import { createError, getHeader, type H3Event } from 'h3'
import { tenantUpstreamHeaders } from './tenantRequest'

const MAX_REQUEST = 16 * 1024 * 1024
const MAX_RESPONSE = 32 * 1024 * 1024
/** Admission gate to the fixed operator upstreams. Odoo serves one request per worker process,
 * and an idle keep-alive connection would pin a worker, so each request uses its own connection
 * and at most UPSTREAM_MAX_CONCURRENCY requests are in flight at once. Excess requests queue
 * here instead of opening connections the kernel drops once the listen backlog fills. */
const configuredConcurrency = Number(process.env.NUXT_ODOO_MAX_CONCURRENCY)
const UPSTREAM_MAX_CONCURRENCY = Number.isFinite(configuredConcurrency) && configuredConcurrency > 0 ? Math.floor(configuredConcurrency) : 32
const UPSTREAM_QUEUE_TIMEOUT = 15_000
let inFlight = 0
const waiters: Array<() => void> = []

function acquire(signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(failure())
  if (inFlight < UPSTREAM_MAX_CONCURRENCY) { inFlight++; return Promise.resolve() }
  return new Promise((resolve, reject) => {
    const cleanup = () => { clearTimeout(timer); signal?.removeEventListener('abort', cancel) }
    const cancel = () => {
      const index = waiters.indexOf(resume)
      if (index >= 0) waiters.splice(index, 1)
      cleanup()
      reject(failure())
    }
    const timer = setTimeout(cancel, UPSTREAM_QUEUE_TIMEOUT)
    const resume = () => { cleanup(); resolve() }
    waiters.push(resume)
    signal?.addEventListener('abort', cancel, { once: true })
  })
}

function release(): void {
  const next = waiters.shift()
  if (next) next(); else inFlight--
}

/** Runs `run` while holding one upstream concurrency slot. Every path that talks to the Odoo
 * upstream must go through this, so overload queues inside this process instead of opening
 * connections the kernel drops once the upstream listen backlog fills. */
export async function withUpstreamSlot<T>(run: () => Promise<T>): Promise<T> {
  await acquire()
  try { return await run() } finally { release() }
}
const failure = () => createError({ statusCode: 502, message: 'tenant_upstream_unavailable' })

/** Server-only, fixed operator configuration. No request-controlled destination or redirects.
 * Bounded buffering deliberately replaces streaming: max16MiB request/32MiB response,
 * 15s total deadline. This supports current JSON attachments, not unbounded exports.
 * By default the call is destroyed when the browser disconnects; `ignoreClientClose` is only for a step that must finish
 * once begun (a claimed AI write) and keeps just the deadline and the optional `signal`. */
export async function tenantTransport(event: H3Event, configuredUpstream: string, path: string, options: { method?: string; body?: string | Buffer; headers?: Record<string, string>; signal?: AbortSignal; ignoreClientClose?: boolean } = {}): Promise<Response> {
  const binding = tenantUpstreamHeaders(event)
  if (!binding.host) throw failure()
  let base: URL
  try { base = new URL(configuredUpstream) } catch { throw failure() }
  if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password || base.pathname !== '/' || base.search || base.hash ||
      !/^\/(?:api\/v1\/|web\/session\/(?:authenticate|destroy)(?:$|\?))/.test(path) || path.startsWith('//') || /[\\\r\n#]/.test(path) || new URL(path, base).pathname !== path.split('?')[0]) throw failure()
  const body = options.body
  if (body && Buffer.byteLength(body) > MAX_REQUEST) throw createError({ statusCode: 413, message: 'payload_too_large' })
  const headers: Record<string, string> = { ...binding }
  // Only explicitly selected application headers, never hop-by-hop or client authority.
  for (const name of ['content-type', 'accept', 'if-none-match', 'if-modified-since', 'range']) {
    const value = options.headers?.[name] ?? getHeader(event, name)
    if (value) headers[name] = value
  }
  const cookie = options.headers?.cookie ?? getHeader(event, 'cookie')
  if (cookie) headers.cookie = cookie
  if (body) headers['content-length'] = String(Buffer.byteLength(body))
  // Listen before admission: a queued request must not miss a client disconnect and send a write later.
  const cancellation = new AbortController()
  const cancel = () => cancellation.abort()
  const disconnected = () => { if (!event.node.res.writableEnded) cancel() }
  if (!options.ignoreClientClose) {
    event.node.req.once('aborted', cancel)
    event.node.res.once('close', disconnected)
    if (event.node.req.aborted || (event.node.res.destroyed && !event.node.res.writableEnded)) cancel()
  }
  if (options.signal?.aborted) cancel(); else options.signal?.addEventListener('abort', cancel, { once: true })
  let admitted = false
  try {
    await acquire(cancellation.signal)
    admitted = true
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
    const timer = setTimeout(abort, 15000)
    cancellation.signal.addEventListener('abort', abort, { once: true })
    request.on('error', () => finish(failure()))
    request.end(body)
    })
  } finally {
    event.node.req.removeListener('aborted', cancel)
    event.node.res.removeListener('close', disconnected)
    options.signal?.removeEventListener('abort', cancel)
    if (admitted) release()
  }
}

export async function boundedTenantBody(event: H3Event): Promise<Buffer | undefined> {
  if (['GET', 'HEAD'].includes(event.method)) return undefined
  const chunks: Buffer[] = []; let length = 0
  const timer = setTimeout(() => event.node.req.destroy(), 15000)
  try {
    for await (const chunk of event.node.req) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      length += buffer.length
      if (length > MAX_REQUEST) throw createError({ statusCode: 413, message: 'payload_too_large' })
      chunks.push(buffer)
    }
    return Buffer.concat(chunks)
  } finally { clearTimeout(timer) }
}
