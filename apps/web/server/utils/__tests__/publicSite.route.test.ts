import http from 'node:http'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { verifyServiceRequest } from '@liwan/commercial-contracts/server'
import { createApp, createError, defineEventHandler, eventHandler, getHeader, getRequestURL, readRawBody, setResponseHeader, setResponseStatus, toNodeListener } from 'h3'
import { resetPublicPricingCacheForTests } from '../customer-commercial'

let upstream: http.Server
let app: http.Server
let base: string
let controlUrl = ''
let calls: { path: string; body: string; headers: http.IncomingHttpHeaders }[] = []
let answer: { status: number; body: unknown } = { status: 200, body: {} }
let enabled = true
const KEY = 'k'.repeat(40)
const TOKEN = 'p'.repeat(40)
const SITE = 'https://site.example'
const saved = { mode: process.env.LIWAN_TENANCY_MODE, token: process.env.LIWAN_SHARED_PROXY_TOKEN }

const pricing = {
  schema_version: 1, currency: 'SAR', tax: 'none',
  free: { users: 3, storage_gb: 20, branches: 1, apps: ['tasks'] },
  apps: [{ key: 'crm', name_ar: 'إدارة العملاء', name_en: 'CRM', monthly: 99, annual: 990 }],
  extra_user: { monthly: 29, annual: 290, max_users: 100 },
  extra_storage: { per_gb_monthly: 1, block_gb: 10, block_monthly: 10, step_gb: 10, step_gb_after: 100, step_gb_large: 100 },
  onboarding: { one_time: 499 }, refund_days: 14,
}

beforeAll(async () => {
  for (const [name, value] of Object.entries({ createError, defineEventHandler, getHeader, getRequestURL, readRawBody, setResponseHeader, setResponseStatus })) vi.stubGlobal(name, value)
  vi.stubGlobal('useRuntimeConfig', () => ({
    customerCommercialEnabled: enabled, customerCommercialPublicOrigin: base, customerCommercialControlUrl: controlUrl,
    customerCommercialIssuer: 'liwan-web', customerCommercialServiceKey: KEY, marketingSiteOrigins: `${SITE}, https://www.site.example`,
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
  h3.use('/api/commercial/public/pricing', eventHandler(async event => event.method === 'GET' ? (await import('../../api/commercial/public/pricing.get')).default(event) : undefined))
  h3.use('/api/commercial/public/contact', eventHandler(async event => event.method === 'OPTIONS'
    ? (await import('../../api/commercial/public/contact.options')).default(event)
    : (await import('../../api/commercial/public/contact.post')).default(event)))
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
  calls = []; answer = { status: 200, body: pricing }; enabled = true; resetPublicPricingCacheForTests()
})
afterEach(() => {
  for (const [name, value] of [['LIWAN_TENANCY_MODE', saved.mode], ['LIWAN_SHARED_PROXY_TOKEN', saved.token]] as const) { if (value === undefined) delete process.env[name]; else process.env[name] = value }
})

const edge = { 'x-liwan-proxy-token': TOKEN, 'x-liwan-client-ip': '203.0.113.7' }
const getPricing = (headers: Record<string, string> = edge) => fetch(`${base}/api/commercial/public/pricing`, { headers })
const message = { name: 'Sara', email: 'sara@acme.com.sa', message: 'Hello', consent: true, turnstile_token: 'tok' }
const postContact = (body: unknown = message, headers: Record<string, string> = { ...edge, origin: SITE, 'content-type': 'application/json' }) =>
  fetch(`${base}/api/commercial/public/contact`, { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body), headers })

describe('GET /api/commercial/public/pricing', () => {
  it('relays the published offer with the site contract headers, signed with no visitor data', async () => {
    const res = await getPricing({ ...edge, origin: SITE })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual(pricing)
    expect(res.headers.get('access-control-allow-origin')).toBe(SITE)
    expect(res.headers.get('vary')).toContain('origin')
    expect(res.headers.get('cache-control')).toBe('public, max-age=60')
    const [call] = calls
    expect(call!.path).toBe('/v1/customer/public/pricing')
    expect(verifyServiceRequest({ method: 'POST', path: call!.path, body: 'liwan-public-pricing:\n{}', headers: call!.headers, key: KEY, anonymous: true })).toMatchObject({ issuer: 'liwan-web' })
    expect(call!.headers.cookie).toBeUndefined()
  })
  it('answers a read from another origin without the CORS grant, and a server read with none', async () => {
    expect((await getPricing({ ...edge, origin: 'https://evil.example' })).headers.get('access-control-allow-origin')).toBeNull()
    const direct = await getPricing()
    expect(direct.status).toBe(200)
    expect(direct.headers.get('access-control-allow-origin')).toBeNull()
  })
  it('keeps the answer for a minute so reads do not reach the control plane each time', async () => {
    await getPricing(); await getPricing()
    expect(calls).toHaveLength(1)
  })
  it('refuses an offer that carries anything beyond the contract, and an unavailable control plane, without caching them', async () => {
    answer = { status: 200, body: { ...pricing, offer_revision: 'x' } }
    const leaked = await getPricing()
    expect(leaked.status).toBe(503)
    expect(leaked.headers.get('cache-control')).toBe('no-store')
    answer = { status: 503, body: { code: 'unavailable' } }
    expect((await getPricing()).status).toBe(503)
    answer = { status: 200, body: pricing }
    expect((await getPricing()).status).toBe(200)
  })
  it('is not served without the shared proxy token, with the integration off, or outside shared mode', async () => {
    expect((await getPricing({})).status).toBe(404)
    enabled = false
    expect((await getPricing()).status).toBe(404)
    enabled = true
    process.env.LIWAN_TENANCY_MODE = 'dedicated'
    expect((await getPricing()).status).toBe(404)
    expect(calls).toHaveLength(0)
  })
})

describe('POST /api/commercial/public/contact', () => {
  it('forwards the body as typed with the edge address signed beside it, and answers 201 {ok:true}', async () => {
    answer = { status: 201, body: { ok: true, id: 'leak' } }
    const res = await postContact()
    expect(res.status).toBe(201)
    expect(await res.json()).toEqual({ ok: true })
    expect(res.headers.get('access-control-allow-origin')).toBe(SITE)
    expect(res.headers.get('cache-control')).toBe('no-store')
    const [call] = calls
    expect(call!.path).toBe('/v1/customer/public/contact')
    expect(JSON.parse(call!.body)).toEqual(message)
    expect(call!.headers['x-liwan-client-ip']).toBe('203.0.113.7')
    expect(verifyServiceRequest({ method: 'POST', path: call!.path, body: `liwan-public-contact:203.0.113.7\n${call!.body}`, headers: call!.headers, key: KEY, anonymous: true })).toMatchObject({ issuer: 'liwan-web' })
  })
  it.each([['business_email_required', 422], ['turnstile_failed', 422], ['invalid_mobile', 422], ['rate_limited', 429]])('passes %s through as a flat code the site reads', async (code, status) => {
    answer = { status, body: { code, message: 'x' } }
    const res = await postContact()
    expect(res.status).toBe(status)
    expect(await res.json()).toEqual({ code, message: 'Request rejected' })
    expect(res.headers.get('access-control-allow-origin')).toBe(SITE)
  })
  it('hides any other control-plane refusal as unavailable', async () => {
    answer = { status: 403, body: { code: 'forbidden' } }
    const res = await postContact()
    expect(res.status).toBe(503)
    expect(await res.json()).toMatchObject({ code: 'unavailable' })
  })
  it('refuses another origin, a missing origin, a non-JSON body and a body that is not an object, before the control plane is called', async () => {
    expect((await postContact(message, { ...edge, origin: 'https://evil.example', 'content-type': 'application/json' })).status).toBe(403)
    expect((await postContact(message, { ...edge, 'content-type': 'application/json' })).status).toBe(403)
    expect((await postContact(message, { ...edge, origin: SITE, 'content-type': 'text/plain' })).status).toBe(415)
    expect((await postContact('[1]')).status).toBe(422)
    expect((await postContact('not json')).status).toBe(422)
    expect(calls).toHaveLength(0)
  })
  it('needs the edge address, and is not served off the common host', async () => {
    const { 'x-liwan-client-ip': _address, ...noAddress } = edge
    expect((await postContact(message, { ...noAddress, origin: SITE, 'content-type': 'application/json' })).status).toBe(503)
    expect((await postContact(message, { 'x-liwan-client-ip': '203.0.113.7', origin: SITE, 'content-type': 'application/json' })).status).toBe(404)
    expect(calls).toHaveLength(0)
  })
  it('refuses a body above the cap', async () => {
    const res = await postContact({ ...message, message: 'x'.repeat(13_000) })
    expect(res.status).toBeGreaterThanOrEqual(400)
    expect(calls).toHaveLength(0)
  })
})

describe('OPTIONS /api/commercial/public/contact', () => {
  const preflight = (origin: string) => fetch(`${base}/api/commercial/public/contact`, { method: 'OPTIONS', headers: { ...edge, origin, 'access-control-request-method': 'POST' } })
  it('lets the site post JSON and nothing else', async () => {
    const res = await preflight(SITE)
    expect(res.status).toBe(204)
    expect(res.headers.get('access-control-allow-origin')).toBe(SITE)
    expect(res.headers.get('access-control-allow-methods')).toBe('POST')
    expect(res.headers.get('access-control-allow-headers')).toBe('content-type')
  })
  it('refuses another origin', async () => {
    const res = await preflight('https://evil.example')
    expect(res.status).toBe(403)
    expect(res.headers.get('access-control-allow-origin')).toBeNull()
  })
})
