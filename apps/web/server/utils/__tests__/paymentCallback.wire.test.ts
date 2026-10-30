import http from 'node:http'
import { afterEach, expect, it, vi } from 'vitest'
import * as h3 from 'h3'
import { $fetch } from 'ofetch'
import { verifyServiceRequest } from '@liwan/commercial-contracts/server'

const KEY = 'k'.repeat(48)
const ATTEMPT = '3f2b8c1e-5d4a-4b7e-9c10-2a6d8e0f1b34'
const ORDER = '9a7c5e3b-1d2f-4a6b-8c0e-4f2a6b8d0c1e'
const servers: http.Server[] = []

async function listen(server: http.Server) {
  servers.push(server)
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  return `http://127.0.0.1:${(server.address() as { port: number }).port}`
}

// A real h3 app in front of a fake control plane that verifies the anonymous signature exactly as the
// control plane does, so this proves the bytes on the wire and not only the helper's call arguments.
async function fixture(reply: (req: http.IncomingMessage, res: http.ServerResponse) => void = (_req, res) => res.end(JSON.stringify({ order_id: ORDER, payment_state: 'paid', fulfillment_state: 'queued' }))) {
  vi.resetModules()
  const received: { method?: string; url?: string; verified: boolean; tenant?: string; body: string }[] = []
  const control = http.createServer((req, res) => {
    let body = ''
    req.on('data', chunk => { body += chunk })
    req.on('end', () => {
      const tenant = String(req.headers['x-liwan-tenant'])
      received.push({ method: req.method, url: req.url, tenant, body, verified: !!verifyServiceRequest({ method: req.method!, path: req.url!, body: `liwan-payment-return:${tenant}\n`, headers: req.headers, key: KEY, anonymous: true }) })
      res.setHeader('content-type', 'application/json')
      reply(req, res)
    })
  })
  const controlUrl = await listen(control)
  for (const name of ['createError', 'getMethod', 'getRequestURL', 'setResponseStatus', 'setResponseHeader', 'getHeader', 'getCookie', 'setCookie', 'readRawBody'] as const) vi.stubGlobal(name, h3[name])
  vi.stubGlobal('$fetch', $fetch)
  vi.stubGlobal('useRuntimeConfig', () => ({ customerCommercialEnabled: true, customerCommercialControlUrl: controlUrl, customerCommercialServiceKey: KEY, customerCommercialIssuer: 'customer-web', customerCommercialTenantId: 'tenant-acme' }))
  const { relayPaymentReturn, resetRateLimitForTests } = await import('../customer-commercial')
  resetRateLimitForTests()
  const app = h3.createApp()
  app.use('/api/commercial/payment-callback', h3.defineEventHandler(relayPaymentReturn))
  const web = await listen(http.createServer(h3.toNodeListener(app)))
  return { received, call: (query: string, init: RequestInit = {}) => fetch(`${web}/api/commercial/payment-callback${query}`, { redirect: 'manual', ...init }) }
}

afterEach(async () => {
  vi.unstubAllGlobals()
  for (const server of servers.splice(0)) { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())) }
})

it('GET relays one anonymous signed lookup and redirects the browser to the order status without cookies', async () => {
  const f = await fixture()
  const response = await f.call(`?attempt=${ATTEMPT}`, { headers: { cookie: 'session_id=secret' } })
  expect(response.status).toBe(303)
  expect(response.headers.get('location')).toBe(`/subscription/status?order=${ORDER}`)
  expect(response.headers.get('cache-control')).toBe('no-store')
  expect(response.headers.get('set-cookie')).toBeNull()
  expect(f.received).toEqual([{ method: 'POST', url: `/v1/customer/payment-returns/${ATTEMPT}`, tenant: 'tenant-acme', body: '', verified: true }])
})

it('POST answers 204, ignores its body and still relays the lookup', async () => {
  const f = await fixture()
  const response = await f.call(`?attempt=${ATTEMPT}`, { method: 'POST', body: JSON.stringify({ order_id: 'x', tenant_id: 'evil' }), headers: { 'content-type': 'application/json' } })
  expect(response.status).toBe(204)
  expect(await response.text()).toBe('')
  expect(f.received).toHaveLength(1)
  expect(f.received[0]).toMatchObject({ body: '', verified: true, tenant: 'tenant-acme' })
})

it('falls back to /subscription when the attempt is malformed, or the control plane refuses or redirects', async () => {
  const f = await fixture((_req, res) => { res.statusCode = 404; res.end('{"code":"not_found"}') })
  const missing = await f.call(`?attempt=${ATTEMPT}`)
  expect([missing.status, missing.headers.get('location')]).toEqual([303, '/subscription'])
  const bad = await f.call('?attempt=nope')
  expect([bad.status, bad.headers.get('location')]).toEqual([303, '/subscription'])
  expect(f.received).toHaveLength(1)
  const redirecting = await fixture((_req, res) => { res.statusCode = 302; res.setHeader('location', 'http://127.0.0.1:1/'); res.end() })
  const followed = await redirecting.call(`?attempt=${ATTEMPT}`)
  expect([followed.status, followed.headers.get('location')]).toEqual([303, '/subscription'])
})
