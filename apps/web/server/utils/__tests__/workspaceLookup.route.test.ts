import http from 'node:http'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { verifyServiceRequest } from '@liwan/commercial-contracts/server'
import { createApp, createError, defineEventHandler, eventHandler, getHeader, getRequestURL, readRawBody, setResponseHeader, setResponseStatus, toNodeListener } from 'h3'

let upstream: http.Server
let app: http.Server
let base: string
let controlUrl = ''
let calls: { path: string; body: string; headers: http.IncomingHttpHeaders }[] = []
let answer: { status: number; body: unknown } = { status: 202, body: { ok: true } }
const KEY = 'k'.repeat(40)
const TOKEN = 'p'.repeat(40)
const saved = { mode: process.env.LIWAN_TENANCY_MODE, token: process.env.LIWAN_SHARED_PROXY_TOKEN }
let signupEnabled = true

beforeAll(async () => {
  for (const [name, value] of Object.entries({ createError, defineEventHandler, getHeader, getRequestURL, readRawBody, setResponseHeader, setResponseStatus })) vi.stubGlobal(name, value)
  vi.stubGlobal('useRuntimeConfig', () => ({
    customerCommercialEnabled: true, publicSignupEnabled: signupEnabled, customerCommercialPublicOrigin: base, customerCommercialControlUrl: controlUrl,
    customerCommercialIssuer: 'liwan-web', customerCommercialServiceKey: KEY,
  }))
  vi.stubGlobal('$fetch', Object.assign(async () => { throw new Error('unused') }, {
    raw: async (url: string, options: RequestInit) => {
      const res = await fetch(url, options)
      return { ok: res.ok, status: res.status, _data: await res.json() }
    },
  }))
  upstream = http.createServer(async (req, res) => {
    const chunks: Buffer[] = []
    for await (const chunk of req) chunks.push(Buffer.from(chunk))
    calls.push({ path: req.url!, body: Buffer.concat(chunks).toString(), headers: req.headers })
    res.writeHead(answer.status, { 'content-type': 'application/json' })
    res.end(JSON.stringify(answer.body))
  })
  await new Promise<void>(resolve => upstream.listen(0, '127.0.0.1', resolve))
  controlUrl = `http://127.0.0.1:${(upstream.address() as { port: number }).port}`
  const h3 = createApp()
  h3.use('/api/invitations/find-workspace', eventHandler((await import('../../api/invitations/find-workspace.post')).default))
  app = http.createServer(toNodeListener(h3))
  await new Promise<void>(resolve => app.listen(0, '127.0.0.1', resolve))
  base = `http://127.0.0.1:${(app.address() as { port: number }).port}`
})
afterAll(async () => {
  await Promise.all([upstream, app].map(s => new Promise<void>(resolve => s.close(() => resolve()))))
  vi.unstubAllGlobals()
})
beforeEach(() => {
  process.env.LIWAN_TENANCY_MODE = 'shared'; process.env.LIWAN_SHARED_PROXY_TOKEN = TOKEN
  calls = []; answer = { status: 202, body: { ok: true } }; signupEnabled = true
})
afterEach(() => {
  for (const [name, value] of [['LIWAN_TENANCY_MODE', saved.mode], ['LIWAN_SHARED_PROXY_TOKEN', saved.token]] as const) { if (value === undefined) delete process.env[name]; else process.env[name] = value }
})

const edge = { 'x-liwan-client-ip': '203.0.113.7', 'x-liwan-proxy-token': TOKEN }
const post = (body: unknown, headers: Record<string, string> = edge, path = '/api/invitations/find-workspace') => fetch(`${base}${path}`, {
  method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body),
  headers: { 'content-type': 'application/json', origin: base, ...headers },
})
const valid = { email: ' admin@x.test ', human_token: 'tok' }

describe('POST /api/invitations/find-workspace', () => {
  it('answers {ok:true} and nothing from the control plane, forwarding only the trimmed address and the token', async () => {
    answer = { status: 202, body: { ok: true, to: 'leak@example.test' } }
    const res = await post({ ...valid, tenant_id: 'other', extra: 1 })
    expect(res.status).toBe(202)
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(await res.json()).toEqual({ ok: true })
    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({ path: '/v1/customer/find-workspace', body: JSON.stringify({ email: 'admin@x.test', human_token: 'tok' }) })
  })
  it('signs the visitor address together with the body, as no tenant is bound on the common host, and forwards no cookie', async () => {
    await post(valid, { ...edge, cookie: 'session_id=secret' })
    const { headers, body } = calls[0]!
    expect(headers['x-liwan-client-ip']).toBe('203.0.113.7')
    expect(headers['x-liwan-tenant']).toBeUndefined()
    expect(headers.cookie).toBeUndefined()
    expect(verifyServiceRequest({ method: 'POST', path: '/v1/customer/find-workspace', body: `liwan-find-workspace:203.0.113.7\n${body}`, headers, key: KEY, anonymous: true })).toMatchObject({ issuer: 'liwan-web' })
    expect(verifyServiceRequest({ method: 'POST', path: '/v1/customer/find-workspace', body: `liwan-find-workspace:203.0.113.8\n${body}`, headers, key: KEY, anonymous: true })).toBeNull()
  })
  it('is served on the common host only: another host, no proxy token or sign-up switched off is a 404', async () => {
    expect((await post(valid, { 'x-liwan-client-ip': '203.0.113.7' })).status).toBe(404)
    expect((await post(valid, { ...edge, 'x-liwan-proxy-token': 'x'.repeat(40) })).status).toBe(404)
    process.env.LIWAN_TENANCY_MODE = 'dedicated'
    expect((await post(valid)).status).toBe(404)
    process.env.LIWAN_TENANCY_MODE = 'shared'; signupEnabled = false
    expect((await post(valid)).status).toBe(404)
    expect(calls).toEqual([])
  })
  it('refuses, without contacting the control plane, when the edge supplied no address or a malformed one', async () => {
    for (const headers of [{ 'x-liwan-proxy-token': TOKEN }, { ...edge, 'x-liwan-client-ip': 'not-an-ip' }]) expect((await post(valid, headers)).status).toBe(503)
    expect(calls).toEqual([])
  })
  it('rejects a foreign origin, non-JSON and malformed or oversize bodies before contacting the control plane', async () => {
    expect((await post(valid, { ...edge, origin: 'https://evil.example.test' })).status).toBe(403)
    expect((await post(valid, { ...edge, 'content-type': 'text/plain' })).status).toBe(415)
    for (const body of ['not json', {}, { email: 'a@x.test' }, { human_token: 'tok' }, { email: 5, human_token: 'tok' }, { email: 'a@x.test', human_token: '' }, { email: 'ab', human_token: 'tok' }, { email: `${'a'.repeat(300)}@x.test`, human_token: 'tok' }, { email: 'a@x.test', human_token: 't'.repeat(2049) }]) {
      expect((await post(body)).status, JSON.stringify(body).slice(0, 40)).toBe(400)
    }
    expect((await post({ email: 'a@x.test', human_token: 't'.repeat(5000) })).status).toBeGreaterThanOrEqual(400)
    expect(calls).toEqual([])
  })
  it('passes the control plane refusals that say nothing about the address and maps every other failure to 503', async () => {
    for (const [status, code] of [[429, 'rate_limited'], [422, 'human_check_failed'], [503, 'human_check_unavailable'], [400, 'invalid']] as const) {
      answer = { status, body: { code, message: 'x' } }
      const res = await post(valid)
      expect([res.status, (await res.json()).data?.code]).toEqual([status, code])
    }
    for (const [status, code] of [[403, 'forbidden'], [500, 'boom'], [503, 'unavailable']] as const) {
      answer = { status, body: { code } }
      const res = await post(valid)
      expect([res.status, (await res.json()).data?.code]).toEqual([503, 'unavailable'])
    }
  })
})
