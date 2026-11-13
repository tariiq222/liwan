import http from 'node:http'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { verifyServiceRequest } from '@liwan/commercial-contracts/server'
import { createApp, createError, defineEventHandler, eventHandler, getHeader, readRawBody, setResponseHeader, setResponseStatus, toNodeListener } from 'h3'

let upstream: http.Server
let app: http.Server
let base: string
let controlUrl = ''
let calls: { path: string; body: string; headers: http.IncomingHttpHeaders }[] = []
let answer = 202
const KEY = 'k'.repeat(40)
const TENANT = '11111111-2222-4333-8444-555555555555'

beforeAll(async () => {
  for (const [name, value] of Object.entries({ createError, defineEventHandler, getHeader, readRawBody, setResponseHeader, setResponseStatus })) vi.stubGlobal(name, value)
  vi.stubGlobal('useRuntimeConfig', () => ({
    customerCommercialPublicOrigin: 'https://app.example.test', customerCommercialControlUrl: controlUrl, customerCommercialIssuer: 'liwan-web',
    customerCommercialServiceKey: KEY, customerCommercialTenantId: TENANT,
  }))
  vi.stubGlobal('$fetch', Object.assign(async () => { throw new Error('unused') }, {
    raw: async (url: string, options: RequestInit) => {
      const res = await fetch(url, options)
      if (!res.ok) throw Object.assign(new Error('upstream'), { statusCode: res.status })
      return { status: res.status, _data: await res.json() }
    },
  }))
  upstream = http.createServer(async (req, res) => {
    const chunks: Buffer[] = []
    for await (const chunk of req) chunks.push(Buffer.from(chunk))
    calls.push({ path: req.url!, body: Buffer.concat(chunks).toString(), headers: req.headers })
    res.writeHead(answer, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ ok: true, to: 'leak@example.test' }))
  })
  await new Promise<void>(resolve => upstream.listen(0, '127.0.0.1', resolve))
  controlUrl = `http://127.0.0.1:${(upstream.address() as { port: number }).port}`
  const h3 = createApp()
  h3.use('/reissue', eventHandler((await import('../../api/invitations/reissue.post')).default))
  app = http.createServer(toNodeListener(h3))
  await new Promise<void>(resolve => app.listen(0, '127.0.0.1', resolve))
  base = `http://127.0.0.1:${(app.address() as { port: number }).port}`
})
afterAll(async () => {
  await Promise.all([upstream, app].map(s => new Promise<void>(resolve => s.close(() => resolve()))))
  vi.unstubAllGlobals()
})

const post = (body: unknown, headers: Record<string, string> = {}) => fetch(`${base}/reissue`, {
  method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body),
  headers: { 'content-type': 'application/json', origin: 'https://app.example.test', ...headers },
})

describe('POST /api/invitations/reissue', () => {
  it('answers {ok:true} and nothing from the control plane, forwarding only the trimmed email', async () => {
    calls = []; answer = 202
    const res = await post({ email: '  admin@x.test ', tenant_id: 'other', extra: 1 }, { 'x-liwan-client-ip': '203.0.113.7' })
    expect(res.status).toBe(202)
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(await res.json()).toEqual({ ok: true })
    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({ path: '/v1/invitations/reissue', body: JSON.stringify({ email: 'admin@x.test' }) })
  })
  it('signs the bound tenant and the edge address, and forwards no cookie', async () => {
    calls = []
    await post({ email: 'admin@x.test' }, { 'x-liwan-client-ip': '203.0.113.7', cookie: 'session_id=secret' })
    const headers = calls[0]!.headers
    expect(headers['x-liwan-tenant']).toBe(TENANT)
    expect(headers['x-liwan-client-ip']).toBe('203.0.113.7')
    expect(headers.cookie).toBeUndefined()
    expect(verifyServiceRequest({ method: 'POST', path: '/v1/invitations/reissue', body: `liwan-invitation-reissue:${TENANT}\n203.0.113.7\n`, headers, key: KEY, anonymous: true })).toMatchObject({ issuer: 'liwan-web' })
  })
  it('refuses, without contacting the control plane, when the edge supplied no address or a malformed one', async () => {
    for (const extra of [{}, { 'x-liwan-client-ip': 'not-an-ip' }] as Record<string, string>[]) {
      calls = []
      expect((await post({ email: 'admin@x.test' }, extra)).status).toBe(503)
      expect(calls).toEqual([])
    }
  })
  it('rejects cross-origin, non-JSON, malformed and oversize bodies before contacting the control plane', async () => {
    calls = []
    expect((await post({ email: 'a@x.test' }, { origin: 'https://evil.example.test' })).status).toBe(403)
    expect((await post({ email: 'a@x.test' }, { 'sec-fetch-site': 'cross-site' })).status).toBe(403)
    expect((await post({ email: 'a@x.test' }, { 'content-type': 'text/plain' })).status).toBe(415)
    for (const body of ['not json', {}, { email: 5 }, { email: 'no-at-sign' }, { email: `${'a'.repeat(300)}@x.test` }]) expect((await post(body)).status).toBe(400)
    expect((await post({ email: `${'a'.repeat(2000)}@x.test` })).status).toBeGreaterThanOrEqual(400)
    expect(calls).toEqual([])
  })
  it('passes a rate limit through as 429 and any other failure as 503', async () => {
    const edge = { 'x-liwan-client-ip': '203.0.113.7' }
    answer = 429
    expect((await post({ email: 'a@x.test' }, edge)).status).toBe(429)
    for (const status of [403, 500]) { answer = status; expect((await post({ email: 'a@x.test' }, edge)).status).toBe(503) }
    answer = 202
  })
})
