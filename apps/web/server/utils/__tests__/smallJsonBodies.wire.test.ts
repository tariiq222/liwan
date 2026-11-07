import http from 'node:http'
import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import * as h3 from 'h3'

let upstream: http.Server
let app: http.Server
let base = ''
let upstreamUrl = ''
let effectDeadline = 0
let forwarded = 0
let principalStatus = 200
let principalReset = false
const csrf = 'c'.repeat(40)
const config = () => ({ odooUrl: upstreamUrl, customerCommercialEnabled: true, customerCommercialPublicOrigin: 'https://app.example.test', customerCommercialControlUrl: upstreamUrl, customerCommercialServiceKey: 'k'.repeat(48), customerCommercialIssuer: 'customer-web', customerCommercialTenantId: 'tenant' })

beforeAll(async () => {
  for (const name of ['createError', 'defineEventHandler', 'getHeader', 'getCookie', 'getMethod', 'getRequestURL', 'readRawBody', 'setResponseHeader', 'setResponseStatus', 'setCookie'] as const) vi.stubGlobal(name, h3[name])
  vi.stubGlobal('useRuntimeConfig', config)
  vi.stubEnv('LIWAN_TENANCY_MODE', 'dedicated')
  const raw = async (url: string, options: RequestInit) => {
    const res = await fetch(url, options)
    const data = await res.json()
    if (!res.ok) throw Object.assign(new Error('upstream'), { statusCode: res.status, data })
    return Object.assign(res, { _data: data })
  }
  vi.stubGlobal('$fetch', Object.assign(async (url: string, options: RequestInit) => (await raw(url, options))._data, { raw }))
  upstream = http.createServer(async (req, res) => {
    const chunks: Buffer[] = []
    for await (const chunk of req) chunks.push(Buffer.from(chunk))
    res.setHeader('content-type', 'application/json')
    if (req.url === '/api/v1/me') {
      if (principalReset) { req.socket.destroy(); return }
      if (principalStatus !== 200) { res.statusCode = principalStatus; res.end('{}'); return }
      res.end(JSON.stringify({ id: 7, name: 'U', login: 'u', email: '', lang: 'ar_001', tz: 'UTC', role: 'employee', capabilities: ['settings.branding.manage'], company: { id: 1, name: 'C' } })); return
    }
    forwarded++
    res.end(JSON.stringify(req.url?.endsWith('/check') ? { usable: true } : req.url?.endsWith('/accept') ? { login: 'u' } : { ok: true }))
  })
  await new Promise<void>(resolve => upstream.listen(0, '127.0.0.1', resolve))
  upstreamUrl = `http://127.0.0.1:${(upstream.address() as { port: number }).port}`
  const appH3 = h3.createApp()
  appH3.use('/check', (await import('../../api/invitations/check.post')).default)
  appH3.use('/accept', (await import('../../api/invitations/accept.post')).default)
  appH3.use('/api/commercial', h3.defineEventHandler((await import('../customer-commercial')).forwardCustomerRequest))
  app = http.createServer(h3.toNodeListener(appH3))
  await new Promise<void>(resolve => app.listen(0, '127.0.0.1', resolve))
  base = `http://127.0.0.1:${(app.address() as { port: number }).port}`
})
afterAll(async () => {
  for (const server of [app, upstream]) { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())) }
  vi.unstubAllGlobals(); vi.unstubAllEnvs()
})
const headers = { 'content-type': 'application/json', origin: 'https://app.example.test', cookie: `session_id=valid; liwan_csrf=${csrf}`, 'x-liwan-csrf': csrf }
const routes = [['/check', 2048], ['/accept', 8192], ['/api/commercial/v1/quotes', 65536]] as const

it.each(routes)('rejects a chunked body exceeding %s budget without forwarding it', async (path, limit) => {
  const before = forwarded
  const status = await new Promise<number>((resolve, reject) => {
    const req = http.request(base + path, { method: 'POST', headers: { ...headers, 'transfer-encoding': 'chunked' } }, res => { res.resume(); resolve(res.statusCode!); req.destroy() })
    req.on('error', error => { if ((error as NodeJS.ErrnoException).code !== 'ECONNRESET') reject(error) })
    req.end(JSON.stringify({ token: 't'.repeat(32), password: 'long-enough-password', padding: 'x'.repeat(limit) }))
  })
  expect(status).toBe(413)
  expect(forwarded).toBe(before)
})
it.each(routes)('ends a stalled %s body under the reader deadline and recovers capacity', async path => {
  const status = await new Promise<number>((resolve, reject) => {
    const req = http.request(base + path, { method: 'POST', headers: { ...headers, 'transfer-encoding': 'chunked' } }, res => { clearTimeout(watchdog); res.resume(); resolve(res.statusCode!); req.destroy() })
    const watchdog = setTimeout(() => { req.destroy(); reject(new Error('body reader did not enforce its deadline')) }, 16_500)
    req.on('error', error => { clearTimeout(watchdog); if ((error as NodeJS.ErrnoException).code !== 'ECONNRESET') reject(error) })
    req.write('{')
  })
  expect(status).toBe(502)
  const response = await fetch(base + path, { method: 'POST', headers, body: JSON.stringify({ token: 't'.repeat(32), password: 'long-enough-password' }) })
  expect(response.status).toBe(200)
}, 20_000)
it('keeps the accepted invitation effect deadline separate from the short upload deadline', async () => {
  const original = AbortSignal.timeout.bind(AbortSignal)
  vi.spyOn(AbortSignal, 'timeout').mockImplementation(ms => { effectDeadline = ms; return original(ms) })
  try {
    const response = await fetch(base + '/accept', { method: 'POST', headers, body: JSON.stringify({ token: 't'.repeat(32), password: 'long-enough-password' }) })
    expect(response.status).toBe(200)
    expect(effectDeadline).toBe(230_000)
  } finally { vi.restoreAllMocks() }
})

it.each([[401, 401], [403, 401], [500, 503], [503, 503]] as const)('classifies a real upstream principal status %s as %s', async (upstreamStatus, expected) => {
  principalStatus = upstreamStatus
  try {
    const before = forwarded
    const response = await fetch(base + '/api/commercial/v1/subscription', { headers })
    expect(response.status).toBe(expected)
    expect((await response.json()).data.code).toBe(expected === 401 ? 'unauthorized' : 'commercial_unavailable')
    expect(forwarded).toBe(before)
  } finally { principalStatus = 200 }
})
it('keeps a reset principal connection transient without forwarding a commercial request', async () => {
  principalReset = true
  try {
    const before = forwarded
    const response = await fetch(base + '/api/commercial/v1/subscription', { headers })
    expect(response.status).toBe(503)
    expect((await response.json()).data.code).toBe('commercial_unavailable')
    expect(forwarded).toBe(before)
  } finally { principalReset = false }
})
