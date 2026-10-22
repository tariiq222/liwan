import http from 'node:http'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, defineEventHandler, proxyRequest, toNodeListener } from 'h3'

let upstream: http.Server
let app: http.Server
let upstreamUrl: string
let url: string
let calls = 0

beforeAll(async () => {
  vi.stubGlobal('defineEventHandler', defineEventHandler)
  vi.stubGlobal('proxyRequest', proxyRequest)
  vi.stubGlobal('useRuntimeConfig', () => ({ odooUrl: upstreamUrl, authProxyClientIpHeader: '' }))
  const handler = (await import('../../routes/api/v1/[...path]')).default
  upstream = http.createServer((req, res) => {
    calls++
    req.resume()
    res.setHeader('content-type', 'application/json')
    res.end('{}')
  })
  await new Promise<void>(resolve => upstream.listen(0, '127.0.0.1', resolve))
  upstreamUrl = `http://127.0.0.1:${(upstream.address() as { port: number }).port}`
  const h3 = createApp()
  h3.use(handler)
  app = http.createServer(toNodeListener(h3))
  await new Promise<void>(resolve => app.listen(0, '127.0.0.1', resolve))
  url = `http://127.0.0.1:${(app.address() as { port: number }).port}`
})
beforeEach(() => { calls = 0; vi.stubEnv('WEBVUE_TENANCY_MODE', 'dedicated') })
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
    expect(response.status).toBe(403)
    expect(calls).toBe(0)
  })
  it('forwards an exact nonempty session cookie among other cookies', async () => {
    const response = await fetch(`${url}/api/v1/me`, { headers: { cookie: 'other=ok; session_id=synthetic; preference=ar' } })
    expect(response.status).toBe(200)
    expect(calls).toBe(1)
  })
  it('preserves public branding without a session', async () => {
    expect((await fetch(`${url}/api/v1/branding`)).status).toBe(200)
    expect(calls).toBe(1)
  })
})
