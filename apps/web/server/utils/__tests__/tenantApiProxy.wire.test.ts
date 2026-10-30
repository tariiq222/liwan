import http from 'node:http'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, defineEventHandler, proxyRequest, toNodeListener } from 'h3'

let upstream: http.Server
let app: http.Server
let upstreamUrl: string
let url: string
let calls = 0
let workCalls = 0
let holdChecks = false
let checkUnavailable = false
let releaseChecks: Array<() => void> = []

beforeAll(async () => {
  vi.stubGlobal('defineEventHandler', defineEventHandler)
  vi.stubGlobal('proxyRequest', proxyRequest)
  vi.stubGlobal('useRuntimeConfig', () => ({ odooUrl: upstreamUrl, authProxyClientIpHeader: '' }))
  const handler = (await import('../../routes/api/v1/[...path]')).default
  upstream = http.createServer((req, res) => {
    calls++
    req.resume()
    res.setHeader('content-type', 'application/json')
    if (req.url === '/api/v1/me') {
      if (checkUnavailable) { res.statusCode = 503; res.end('{}'); return }
      const reply = () => {
        if (!['session_id=valid-wire-session', 'session_id=valid-cold-session', 'session_id=valid-abort-session'].includes(req.headers.cookie ?? '')) { res.statusCode = 403; res.end('{}'); return }
        res.end(JSON.stringify({ id: 7, company: { id: 1 } }))
      }
      if (holdChecks) releaseChecks.push(reply); else reply()
      return
    }
    workCalls++
    if (req.url === '/api/v1/echo') {
      const chunks: Buffer[] = []
      req.on('data', chunk => chunks.push(Buffer.from(chunk)))
      req.on('end', () => res.end(JSON.stringify({ hex: Buffer.concat(chunks).toString('hex') })))
    } else res.end('{}')
  })
  await new Promise<void>(resolve => upstream.listen(0, '127.0.0.1', resolve))
  upstreamUrl = `http://127.0.0.1:${(upstream.address() as { port: number }).port}`
  const h3 = createApp()
  h3.use(handler)
  app = http.createServer(toNodeListener(h3))
  await new Promise<void>(resolve => app.listen(0, '127.0.0.1', resolve))
  url = `http://127.0.0.1:${(app.address() as { port: number }).port}`
})
beforeEach(() => { calls = 0; workCalls = 0; holdChecks = false; checkUnavailable = false; releaseChecks = []; vi.stubEnv('LIWAN_TENANCY_MODE', 'dedicated') })
afterEach(() => vi.unstubAllEnvs())
afterAll(async () => {
  for (const server of [app, upstream]) {
    server?.closeAllConnections()
    if (server) await new Promise<void>(resolve => server.close(() => resolve()))
  }
  vi.unstubAllGlobals()
})

describe('API session preadmission on the wire', () => {
  it.each(['not_session_id=synthetic', 'other=session_id=synthetic', 'session_id=', 'other=ok; session_id='])('refuses %j without contacting Odoo', async (cookie) => {
    const response = await fetch(`${url}/api/v1/me`, { headers: { cookie } })
    expect(response.status).toBe(401)
    expect(calls).toBe(0)
  })
  it.each(['POST', 'GET'])('refuses a browser %s to the server-only /api/v1/ai/usage even with a valid session, and never reaches Odoo', async (method) => {
    const response = await fetch(`${url}/api/v1/ai/usage`, { method, headers: { cookie: 'session_id=valid-wire-session', 'content-type': 'application/json' }, body: method === 'POST' ? '{"items":[]}' : undefined })
    expect(response.status).toBe(404)
    expect(await response.json()).toMatchObject({ data: { code: 'not_found' } })
    expect(calls).toBe(0)
  })
  it('rejects a forged exact cookie before forwarding the operation', async () => {
    const response = await fetch(`${url}/api/v1/tasks`, { method: 'POST', headers: { cookie: 'session_id=synthetic' }, body: '{}' })
    expect(response.status).toBe(401)
    expect(workCalls).toBe(0)
  })
  it('rejects a forged slow upload without waiting for its body', async () => {
    const status = await new Promise<number>((resolve, reject) => {
      const req = http.request(`${url}/api/v1/tasks`, { method: 'POST', headers: { cookie: 'session_id=forged-slow', 'content-type': 'application/json', 'content-length': '100000' } }, res => {
        resolve(res.statusCode!); res.resume(); req.destroy()
      })
      req.on('error', error => { if ((error as NodeJS.ErrnoException).code !== 'ECONNRESET') reject(error) })
      req.setTimeout(1000, () => { req.destroy(); reject(new Error('waited for anonymous body')) })
      req.write('{')
    })
    expect(status).toBe(401)
    expect(workCalls).toBe(0)
  })
  it('reports validation outages as unavailable rather than signing the user out', async () => {
    checkUnavailable = true
    expect((await fetch(`${url}/api/v1/tasks`, { headers: { cookie: 'session_id=unknown-during-outage' } })).status).toBe(503)
    expect(workCalls).toBe(0)
  })
  it('verifies an existing valid Odoo session and preserves application forwarding', async () => {
    const response = await fetch(`${url}/api/v1/tasks`, { headers: { cookie: 'other=ok; session_id=valid-wire-session; preference=ar' } })
    expect(response.status).toBe(200)
    expect(calls).toBe(2)
    expect(workCalls).toBe(1)
  })
  it('preserves buffered upload bytes through dedicated forwarding', async () => {
    const bytes = Buffer.from([0, 255, 1, 128, 42])
    const response = await fetch(`${url}/api/v1/echo`, { method: 'POST', headers: { cookie: 'session_id=valid-wire-session', 'content-type': 'application/octet-stream' }, body: new Uint8Array(bytes) })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ hex: bytes.toString('hex') })
  })
  it('coalesces cold parallel requests from one valid session', async () => {
    holdChecks = true
    const requests = Array.from({ length: 5 }, () => fetch(`${url}/api/v1/tasks`, { headers: { cookie: 'session_id=valid-cold-session' } }))
    try {
      await vi.waitFor(() => expect(releaseChecks).toHaveLength(1))
    } finally { for (const release of releaseChecks) release() }
    expect((await Promise.all(requests)).map(response => response.status)).toEqual([200, 200, 200, 200, 200])
    expect(workCalls).toBe(5)
  })
  it('does not cancel another valid consumer when the first cold caller disconnects', async () => {
    holdChecks = true
    const controller = new AbortController()
    const first = fetch(`${url}/api/v1/tasks`, { headers: { cookie: 'session_id=valid-abort-session' }, signal: controller.signal }).catch(() => undefined)
    await vi.waitFor(() => expect(releaseChecks).toHaveLength(1))
    const second = fetch(`${url}/api/v1/tasks`, { headers: { cookie: 'session_id=valid-abort-session' } })
    await new Promise(resolve => setTimeout(resolve, 30))
    controller.abort()
    for (const release of releaseChecks) release()
    expect((await second).status).toBe(200)
    await first
  })
  it('keeps a public MFA slow upload outside application slots', async () => {
    const upload = http.request(`${url}/api/v1/auth/totp`, { method: 'POST', headers: { 'content-type': 'application/json', 'content-length': '100000' } })
    upload.on('error', () => {})
    upload.write('{')
    try {
      await new Promise(resolve => setTimeout(resolve, 30))
      expect(calls).toBe(0)
      expect((await fetch(`${url}/api/v1/tasks`, { headers: { cookie: 'session_id=valid-wire-session' } })).status).toBe(200)
    } finally { upload.destroy() }
  })
  it('bounds unknown-session checks separately and keeps verified application work available', async () => {
    expect((await fetch(`${url}/api/v1/tasks`, { headers: { cookie: 'session_id=valid-wire-session' } })).status).toBe(200)
    workCalls = 0
    holdChecks = true
    const pending = ['a'].map(id => fetch(`${url}/api/v1/tasks`, { method: 'POST', headers: { cookie: `session_id=forged-${id}` }, body: '{}' }))
    try {
      await vi.waitFor(() => expect(releaseChecks).toHaveLength(1))
      // A second cold identity waits in the lane queue instead of being rejected.
      pending.push(fetch(`${url}/api/v1/tasks`, { headers: { cookie: 'session_id=forged-c' } }))
      expect((await fetch(`${url}/api/v1/tasks`, { headers: { cookie: 'session_id=valid-wire-session' } })).status).toBe(200)
      expect(workCalls).toBe(1)
    } finally {
      releaseChecks[0]!()
      await vi.waitFor(() => expect(releaseChecks).toHaveLength(2))
      releaseChecks[1]!()
      expect((await Promise.all(pending)).map(response => response.status)).toEqual([401, 401])
    }
  })
  it('preserves public branding without a session', async () => {
    expect((await fetch(`${url}/api/v1/branding`)).status).toBe(200)
    expect(calls).toBe(1)
  })
})
