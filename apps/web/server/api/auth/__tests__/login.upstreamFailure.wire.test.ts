import http from 'node:http'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { appendResponseHeader, createApp, createError, defineEventHandler, getHeader, getRequestHeader, getRequestProtocol, readRawBody, toNodeListener } from 'h3'

// Sign-in when Odoo (or a proxy in front of it) answers with something that is not JSON: the route owns the
// failure and answers a structured 502, never a raw SyntaxError.
let upstream: http.Server
let app: http.Server
let base: string
let odooUrl: string
let answer: { status: number, contentType: string, body: string } = { status: 200, contentType: 'application/json', body: '{}' }

beforeAll(async () => {
  for (const [name, value] of Object.entries({ appendResponseHeader, createError, defineEventHandler, getHeader, getRequestHeader, getRequestProtocol, readRawBody })) vi.stubGlobal(name, value)
  vi.stubGlobal('useRuntimeConfig', () => ({ odooUrl, odooDb: 'scratch_login', authProxyClientIpHeader: '' }))
  const { assertSameSiteJson } = await import('../../../utils/same-site')
  vi.stubGlobal('assertSameSiteJson', assertSameSiteJson)

  upstream = http.createServer(async (req, res) => {
    for await (const _chunk of req) { /* drain */ }
    res.writeHead(answer.status, { 'content-type': answer.contentType })
    res.end(answer.body)
  })
  await new Promise<void>(resolve => upstream.listen(0, '127.0.0.1', resolve))
  odooUrl = `http://127.0.0.1:${(upstream.address() as { port: number }).port}`

  const h3 = createApp()
  h3.use('/login', (await import('../login.post')).default)
  app = http.createServer(toNodeListener(h3))
  await new Promise<void>(resolve => app.listen(0, '127.0.0.1', resolve))
  base = `http://127.0.0.1:${(app.address() as { port: number }).port}`
})

beforeEach(() => {
  vi.stubEnv('LIWAN_TENANCY_MODE', 'dedicated')
})

afterAll(async () => {
  for (const server of [app, upstream]) {
    server?.closeAllConnections()
    if (server) await new Promise<void>(resolve => server.close(() => resolve()))
  }
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

function signIn(): Promise<{ status: number, body: { data?: { code?: string } } }> {
  return new Promise((resolve, reject) => {
    const req = http.request(`${base}/login`, { method: 'POST', headers: { 'content-type': 'application/json', 'sec-fetch-site': 'same-origin' } }, (res) => {
      const chunks: Buffer[] = []
      res.on('data', chunk => chunks.push(chunk))
      res.on('end', () => resolve({ status: res.statusCode!, body: JSON.parse(Buffer.concat(chunks).toString()) }))
    })
    req.on('error', reject)
    req.end(JSON.stringify({ login: 'a@example.test', password: 'synthetic' }))
  })
}

describe('sign-in when the upstream answer is not JSON', () => {
  it('turns an HTML error page into a structured 502', async () => {
    answer = { status: 502, contentType: 'text/html', body: '<html><body>Bad Gateway</body></html>' }
    const response = await signIn()
    expect(response.status).toBe(502)
    expect(response.body.data?.code).toBe('tenant_upstream_unavailable')
  })

  it('turns an empty body into a structured 502', async () => {
    answer = { status: 200, contentType: 'application/json', body: '' }
    const response = await signIn()
    expect(response.status).toBe(502)
    expect(response.body.data?.code).toBe('tenant_upstream_unavailable')
  })
})
