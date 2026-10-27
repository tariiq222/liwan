import http from 'node:http'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { appendResponseHeader, createApp, createError, defineEventHandler, getHeader, getRequestHeader, getRequestProtocol, readBody, toNodeListener } from 'h3'

let upstream: http.Server
let app: http.Server
let url: string
let upstreamUrl: string
let calls: http.IncomingHttpHeaders[] = []
let configuredHeader = 'x-webvue-client-ip'
let authenticateAnswer: object = { result: { uid: 7 } }

beforeAll(async () => {
  // Supply Nitro's auto-imports only; H3 request/response handling and the wire are real.
  for (const [name, value] of Object.entries({ appendResponseHeader, createError, defineEventHandler, getHeader, getRequestHeader, getRequestProtocol, readBody })) vi.stubGlobal(name, value)
  vi.stubGlobal('useRuntimeConfig', () => ({ odooUrl: upstreamUrl, odooDb: 'scratch_auth_wire', authProxyClientIpHeader: configuredHeader }))
  const { assertSameSiteJson } = await import('../same-site')
  vi.stubGlobal('assertSameSiteJson', assertSameSiteJson)
  const login = (await import('../../api/auth/login.post')).default
  const totp = (await import('../../api/auth/totp.post')).default
  upstream = http.createServer((req, res) => {
    calls.push(req.headers)
    req.resume()
    res.setHeader('content-type', 'application/json')
    res.setHeader('set-cookie', 'session_id=synthetic-wire-session; HttpOnly; Path=/')
    res.end(req.url === '/web/session/authenticate' ? JSON.stringify(authenticateAnswer) : '{}')
  })
  await new Promise<void>(resolve => upstream.listen(0, '127.0.0.1', resolve))
  upstreamUrl = `http://127.0.0.1:${(upstream.address() as { port: number }).port}`
  const h3 = createApp()
  h3.use('/login', login)
  h3.use('/totp', totp)
  app = http.createServer(toNodeListener(h3))
  await new Promise<void>(resolve => app.listen(0, '127.0.0.1', resolve))
  url = `http://127.0.0.1:${(app.address() as { port: number }).port}`
})

beforeEach(() => { vi.stubEnv('WEBVUE_TENANCY_MODE', 'dedicated'); calls = []; configuredHeader = 'x-webvue-client-ip'; authenticateAnswer = { result: { uid: 7 } } })
afterEach(() => vi.unstubAllEnvs())
afterAll(async () => {
  for (const server of [app, upstream]) {
    server?.closeAllConnections()
    if (server) await new Promise<void>(resolve => server.close(() => resolve()))
  }
  vi.unstubAllGlobals()
})

const edge = { 'x-webvue-client-ip': '203.0.113.7', 'x-webvue-client-host': 'webvue.example.test:8443', 'x-webvue-client-proto': 'https' }
async function request(path: string, headers: Record<string, string> = edge) {
  // Node's fetch may ignore an explicit Host. The shared boundary test needs
  // the literal tenant Host on the wire, as Caddy sends it in production.
  return new Promise<Response>((resolve, reject) => {
    const req = http.request(url + path, { method: 'POST', headers: { 'content-type': 'application/json', ...headers } }, res => {
      const chunks: Buffer[] = []
      res.on('data', chunk => chunks.push(chunk))
      res.on('end', () => {
        const responseHeaders = new Headers()
        for (const [name, value] of Object.entries(res.headers)) {
          for (const item of Array.isArray(value) ? value : value ? [value] : []) responseHeaders.append(name, item)
        }
        resolve(new Response(Buffer.concat(chunks), { status: res.statusCode, headers: responseHeaders }))
      })
    })
    req.on('error', reject)
    req.end(JSON.stringify(path === '/login' ? { login: 'synthetic', password: 'synthetic' } : { code: '123456' }))
  })
}

describe.each(['/login', '/totp'])('dedicated auth identity on %s', (path) => {
  it('forwards only the validated private edge fields and preserves the session cookie', async () => {
    const response = await request(path, { ...edge, 'x-forwarded-for': '198.51.100.99', 'x-forwarded-host': 'evil.example.test', 'x-forwarded-proto': 'http', forwarded: 'for=198.51.100.100' })
    expect(response.status).toBe(200)
    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({ 'x-forwarded-for': '203.0.113.7', 'x-forwarded-host': 'webvue.example.test:8443', 'x-forwarded-proto': 'https' })
    expect(calls[0]?.forwarded).toBeUndefined()
    expect(response.headers.getSetCookie()[0]).toContain('session_id=synthetic-wire-session')
  })

  it.each(['2001:db8::1234', '::ffff:192.0.2.8'])('supports a single IPv6 peer %s', async (ip) => {
    expect((await request(path, { ...edge, 'x-webvue-client-ip': ip })).status).toBe(200)
    expect(calls[0]?.['x-forwarded-for']).toBe(ip)
  })

  it.each(['', '192.0.2.1, 192.0.2.2', 'not-an-ip', 'fe80::1%en0', '192.0.2.1:80'])('rejects malformed or ambiguous identity %j before contacting Odoo', async (ip) => {
    expect((await request(path, { ...edge, 'x-webvue-client-ip': ip })).status).toBe(503)
    expect(calls).toHaveLength(0)
  })

  it('fails closed when the edge field is missing', async () => {
    expect((await request(path, { 'x-forwarded-for': '203.0.113.7' })).status).toBe(503)
    expect(calls).toHaveLength(0)
  })

  it.each([
    { 'x-webvue-client-host': 'user@webvue.example.test' },
    { 'x-webvue-client-host': 'webvue.example.test/other' },
    { 'x-webvue-client-host': 'webvue.example.test,evil.example.test' },
    { 'x-webvue-client-proto': 'ftp' },
  ])('rejects malformed proxy origin %j', async (invalid) => {
    expect((await request(path, { ...edge, ...invalid })).status).toBe(503)
    expect(calls).toHaveLength(0)
  })

  it('rejects configuring the public XFF field as private authority', async () => {
    configuredHeader = 'x-forwarded-for'
    expect((await request(path, { ...edge, 'x-forwarded-for': '203.0.113.7' })).status).toBe(503)
    expect(calls).toHaveLength(0)
  })

  it('keeps direct local development independent of all forwarded headers', async () => {
    configuredHeader = ''
    expect((await request(path, { ...edge, 'x-forwarded-for': '198.51.100.99' })).status).toBe(200)
    expect(calls[0]?.['x-forwarded-for']).toBeUndefined()
    expect(calls[0]?.['x-forwarded-host']).toBeUndefined()
  })
})

it.each(['/login', '/totp'])('shared %s preserves tenant authority without trusting dedicated headers', async (path) => {
  const directory = mkdtempSync(join(tmpdir(), 'webvue-auth-shared-'))
  const registry = join(directory, 'registry.json')
  const token = 'synthetic-shared-auth-boundary'.repeat(2)
  writeFileSync(registry, JSON.stringify({ schemaVersion: 1, snapshotRevision: 1, targets: [{ host: 'a.example.test', tenantId: 'a', database: 'db_a', filestore: 'db_a', enabled: true, registryRevision: 1 }] }))
  vi.stubEnv('WEBVUE_TENANCY_MODE', 'shared')
  vi.stubEnv('WEBVUE_TENANT_REGISTRY_PATH', registry)
  vi.stubEnv('WEBVUE_SHARED_PROXY_TOKEN', token)
  try {
    expect((await request(path, { host: 'a.example.test', 'x-webvue-proxy-token': token, 'x-webvue-tenant-revision': '1', ...edge })).status).toBe(200)
    expect(calls[0]).toMatchObject({ host: 'a.example.test', 'x-webvue-proxy-token': token, 'x-webvue-tenant-revision': '1' })
    expect(calls[0]?.['x-forwarded-for']).toBeUndefined()
    expect(calls[0]?.['x-forwarded-host']).toBeUndefined()
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe('login refusal codes', () => {
  const refused = (name: string) => ({ error: { code: 200, message: 'Odoo Server Error', data: { name, message: 'Access Denied' } } })

  it('names a suspended tenant only for the error Odoo raises after valid credentials', async () => {
    authenticateAnswer = refused('odoo.addons.webvue_platform.models.entitlement_service.WebVueTenantSuspended')
    const response = await request('/login')
    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({ data: { code: 'tenant_suspended' } })
  })

  it('keeps every other refusal a generic invalid_credentials', async () => {
    authenticateAnswer = refused('odoo.exceptions.AccessDenied')
    const response = await request('/login')
    expect(response.status).toBe(401)
    expect(await response.json()).toMatchObject({ data: { code: 'invalid_credentials' } })
  })
})
