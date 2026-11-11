import http from 'node:http'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { verifyServiceRequest } from '@liwan/commercial-contracts/server'
import { createApp, createError, defineEventHandler, eventHandler, getHeader, readRawBody, setResponseHeader, toNodeListener } from 'h3'

let upstream: http.Server
let app: http.Server
let base: string
let controlUrl = ''
let calls: { path: string; body: string }[] = []
let seen: http.IncomingHttpHeaders = {}
const KEY = 'k'.repeat(40)
const LIVE = 'live-token-'.repeat(3)

beforeAll(async () => {
  for (const [name, value] of Object.entries({ createError, defineEventHandler, getHeader, readRawBody, setResponseHeader })) vi.stubGlobal(name, value)
  vi.stubGlobal('useRuntimeConfig', () => ({ customerCommercialPublicOrigin: 'https://app.example.test', customerCommercialControlUrl: controlUrl, customerCommercialIssuer: 'liwan-web', customerCommercialServiceKey: KEY }))
  vi.stubGlobal('$fetch', async (url: string, options: RequestInit) => {
    const res = await fetch(url, options)
    if (!res.ok) throw Object.assign(new Error('upstream'), { statusCode: res.status })
    return res.json()
  })
  upstream = http.createServer(async (req, res) => {
    const chunks: Buffer[] = []
    for await (const chunk of req) chunks.push(Buffer.from(chunk))
    const body = Buffer.concat(chunks).toString()
    calls.push({ path: req.url!, body })
    seen = req.headers
    const token = JSON.parse(body).token as string
    res.setHeader('content-type', 'application/json')
    if (token === 'boom') { res.writeHead(500); res.end('{}'); return }
    // Extra fields a careless upstream might add must never reach the browser.
    res.end(JSON.stringify({ usable: token === LIVE, reason: token === LIVE ? undefined : 'expired' }))
  })
  await new Promise<void>(resolve => upstream.listen(0, '127.0.0.1', resolve))
  controlUrl = `http://127.0.0.1:${(upstream.address() as { port: number }).port}`
  const h3 = createApp()
  h3.use('/check', (await import('../../api/invitations/check.post')).default)
  app = http.createServer(toNodeListener(h3))
  await new Promise<void>(resolve => app.listen(0, '127.0.0.1', resolve))
  base = `http://127.0.0.1:${(app.address() as { port: number }).port}`
})
afterAll(async () => {
  await Promise.all([upstream, app].map(s => new Promise<void>(resolve => s.close(() => resolve()))))
  vi.unstubAllGlobals()
})

const post = (body: unknown, headers: Record<string, string> = {}) => fetch(`${base}/check`, {
  method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body),
  headers: { 'content-type': 'application/json', origin: 'https://app.example.test', ...headers },
})

describe('POST /api/invitations/check', () => {
  it('answers {usable} only, true for a live token', async () => {
    calls = []
    const res = await post({ token: LIVE, extra: 'x' })
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(await res.json()).toEqual({ usable: true })
    expect(calls).toEqual([{ path: '/v1/invitations/check', body: JSON.stringify({ token: LIVE }) }])
  })
  it('gives the identical answer for expired, used, revoked, unknown and malformed tokens', async () => {
    const answers = []
    for (const body of [{ token: 'expired-token-'.repeat(3) }, { token: 'used-token-'.repeat(3) }, { token: 'unknown' }, { token: 5 }, {}, 'not json']) {
      const res = await post(body)
      answers.push([res.status, await res.text()])
    }
    for (const a of answers) expect(a).toEqual([200, '{"usable":false}'])
  })
  it('answers 503 when the check itself is unavailable', async () => {
    expect((await post({ token: 'boom' })).status).toBe(503)
  })
  it('rejects cross-origin and non-JSON requests before contacting the control plane', async () => {
    calls = []
    expect((await post({ token: LIVE }, { origin: 'https://evil.example.test' })).status).toBe(403)
    expect((await post({ token: LIVE }, { 'sec-fetch-site': 'cross-site' })).status).toBe(403)
    expect((await post({ token: LIVE }, { 'content-type': 'text/plain' })).status).toBe(415)
    expect(calls).toEqual([])
  })
  it('signs the edge-derived visitor address for the control plane', async () => {
    await post({ token: LIVE }, { 'x-liwan-client-ip': '203.0.113.7' })
    expect(seen['x-liwan-client-ip']).toBe('203.0.113.7')
    expect(verifyServiceRequest({ method: 'POST', path: '/v1/invitations/check', body: 'liwan-invitation-client:203.0.113.7\n', headers: seen, key: KEY, anonymous: true })).toMatchObject({ issuer: 'liwan-web' })
  })
  it('sends no address or signature when the edge supplied none or a malformed one', async () => {
    for (const extra of [{}, { 'x-liwan-client-ip': 'not-an-ip' }] as Record<string, string>[]) {
      await post({ token: LIVE }, extra)
      expect(seen['x-liwan-client-ip']).toBeUndefined()
      expect(seen['x-liwan-signature']).toBeUndefined()
    }
  })
})
