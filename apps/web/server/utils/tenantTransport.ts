import http from 'node:http'
import https from 'node:https'
import { createError, getHeader, type H3Event } from 'h3'
import { tenantUpstreamHeaders } from './tenantRequest'

const MAX_REQUEST = 16 * 1024 * 1024
const MAX_RESPONSE = 32 * 1024 * 1024
const failure = () => createError({ statusCode: 502, message: 'tenant_upstream_unavailable' })

/** Server-only, fixed operator configuration. No request-controlled destination or redirects.
 * Bounded buffering deliberately replaces streaming: max16MiB request/32MiB response,
 * 15s total deadline. This supports current JSON attachments, not unbounded exports. */
export async function tenantTransport(event: H3Event, configuredUpstream: string, path: string, options: { method?: string; body?: string | Buffer; headers?: Record<string, string> } = {}): Promise<Response> {
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
  return new Promise((resolve, reject) => {
    let settled = false
    const finish = (error?: Error, result?: Response) => {
      if (settled) return
      settled = true; clearTimeout(timer)
      event.node.req.removeListener('aborted', abort)
      event.node.res.removeListener('close', disconnected)
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
    const disconnected = () => { if (!event.node.res.writableEnded) abort() }
    const timer = setTimeout(abort, 15000)
    event.node.req.once('aborted', abort); event.node.res.once('close', disconnected)
    request.on('error', () => finish(failure()))
    request.end(body)
  })
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
