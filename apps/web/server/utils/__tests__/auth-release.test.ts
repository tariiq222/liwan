import http from 'node:http'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { appendResponseHeader, createApp, createError, defineEventHandler, deleteCookie, eventHandler, getHeader, getRequestHeader, getRequestProtocol, readBody, setResponseStatus, toNodeListener } from 'h3'

const token = 'synthetic-dedicated-release-boundary'.repeat(2)
const host = 'tenant.example.test'
const pin = { 'x-liwan-release-pool': 'blue', 'x-liwan-release-revision': '4', 'x-liwan-release-fence': '9' }
const edge = { host, 'x-liwan-proxy-token': token, 'x-liwan-tenant-revision': '2', 'x-liwan-client-ip': '203.0.113.7', 'x-liwan-client-host': host, 'x-liwan-client-proto': 'https' }
let upstream: http.Server
let app: http.Server
let base: string
let odooUrl: string
let failure = false
let configuredHeader = ''
let calls: { path: string; headers: http.IncomingHttpHeaders; body: string }[] = []

beforeAll(async () => {
  for (const [name, value] of Object.entries({ appendResponseHeader, createError, defineEventHandler, deleteCookie, getHeader, getRequestHeader, getRequestProtocol, readBody, setResponseStatus })) vi.stubGlobal(name, value)
  vi.stubGlobal('useRuntimeConfig', () => ({ odooUrl, odooDb: 'liwan_scratch_dedicated_auth', authProxyClientIpHeader: configuredHeader }))
  const { assertSameSiteJson } = await import('../same-site')
  vi.stubGlobal('assertSameSiteJson', assertSameSiteJson)
  vi.stubGlobal('$fetch', async (url: string, options: RequestInit) => (await fetch(url, options)).json())
  const login = (await import('../../api/auth/login.post')).default
  const totp = (await import('../../api/auth/totp.post')).default
  const logout = (await import('../../api/auth/logout.post')).default
  const { authUpstreamHeaders } = await import('../authUpstreamHeaders')
  const { customerPrincipal } = await import('../customer-commercial')
  upstream = http.createServer(async (req, res) => {
    const buffers: Buffer[] = []
    for await (const chunk of req) buffers.push(Buffer.from(chunk))
    calls.push({ path: req.url!, headers: req.headers, body: Buffer.concat(buffers).toString() })
    res.setHeader('content-type', 'application/json')
    if (process.env.LIWAN_RELEASE_ROUTES_DIR && (req.headers.host !== host || req.headers['x-liwan-proxy-token'] !== token || req.headers['x-liwan-tenant-revision'] !== '2' || Object.entries(pin).some(([key, value]) => req.headers[key] !== value))) {
      res.writeHead(403); res.end(JSON.stringify({ code: 'release_binding_missing' })); return
    }
    if (failure) { res.writeHead(500); res.end(JSON.stringify({ error: { code: 'synthetic_failure' } })); return }
    res.setHeader('set-cookie', 'session_id=rotated-session; HttpOnly; Path=/')
    if (req.url === '/api/v1/me') res.end(JSON.stringify({ id: 7, name: 'User', login: 'user', email: '', lang: 'ar_001', tz: 'UTC', role: 'employee', capabilities: ['access.users.read'], company: { id: 1, name: 'Company' } }))
    else res.end(JSON.stringify(req.url === '/web/session/authenticate' ? { result: { uid: 7 } } : { result: {} }))
  })
  await new Promise<void>(resolve => upstream.listen(0, '127.0.0.1', resolve))
  odooUrl = `http://127.0.0.1:${(upstream.address() as { port: number }).port}`
  const h3 = createApp()
  h3.use(eventHandler(event => {
    if (process.env.LIWAN_RELEASE_ROUTES_DIR) event.context.liwanRelease = { tenantId: 'release-route-tenant', identityRevision: 2, poolId: 'blue', releaseId: 'r1', routeRevision: 4, fence: 9, aiMaintenance: false, odooUrl, webUrl: odooUrl, wsUrl: odooUrl }
  }))
  h3.use('/login', login)
  h3.use('/totp', totp)
  h3.use('/logout', logout)
  h3.use('/headers', eventHandler(event => authUpstreamHeaders(event)))
  h3.use('/principal', eventHandler(event => customerPrincipal(event, { odooUrl, customerCommercialTenantId: 'dedicated-config-tenant' })))
  app = http.createServer(toNodeListener(h3))
  await new Promise<void>(resolve => app.listen(0, '127.0.0.1', resolve))
  base = `http://127.0.0.1:${(app.address() as { port: number }).port}`
})

beforeEach(() => {
  calls = []; failure = false; configuredHeader = ''
  vi.stubEnv('LIWAN_TENANCY_MODE', 'dedicated')
  vi.stubEnv('LIWAN_RELEASE_ROUTES_DIR', '/operator/routes')
  vi.stubEnv('LIWAN_DEDICATED_PROXY_TOKEN', token)
  vi.stubEnv('LIWAN_RELEASE_TENANT_HOST', host)
  vi.stubEnv('LIWAN_RELEASE_IDENTITY_REVISION', '2')
})
afterEach(() => vi.unstubAllEnvs())
afterAll(async () => {
  for (const server of [app, upstream]) {
    server?.closeAllConnections()
    if (server) await new Promise<void>(resolve => server.close(() => resolve()))
  }
  vi.unstubAllGlobals()
})

function request(path: string, overrides: Record<string, string> = {}): Promise<Response> {
  return new Promise((resolve, reject) => {
    const req = http.request(base + path, { method: 'POST', headers: { 'content-type': 'application/json', cookie: 'session_id=existing-session', ...edge, ...overrides } }, res => {
      const chunks: Buffer[] = []
      res.on('data', chunk => chunks.push(chunk))
      res.on('end', () => {
        const headers = new Headers()
        for (const [key, value] of Object.entries(res.headers)) for (const item of Array.isArray(value) ? value : value ? [value] : []) headers.append(key, item)
        resolve(new Response(res.statusCode === 204 ? null : Buffer.concat(chunks), { status: res.statusCode, headers }))
      })
    })
    req.on('error', reject)
    req.end(JSON.stringify(path === '/login' ? { login: 'synthetic', password: 'synthetic' } : { code: '123456' }))
  })
}

describe('dedicated release authentication transport', () => {
  it.each([['/login', '/web/session/authenticate', 200], ['/totp', '/api/v1/auth/totp', 200], ['/logout', '/web/session/destroy', 204]] as const)('%s preserves the verified boundary, release pin and raw session cookie', async (path, target, status) => {
    const response = await request(path)
    expect(response.status).toBe(status)
    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({ path: target, headers: { host, 'x-liwan-proxy-token': token, 'x-liwan-tenant-revision': '2', ...pin, cookie: 'session_id=existing-session' } })
    const cookies = response.headers.getSetCookie()
    if (path === '/logout') expect(cookies.some(cookie => cookie.startsWith('session_id=;') && cookie.includes('Max-Age=0'))).toBe(true)
    else expect(cookies.some(cookie => cookie.startsWith('session_id=rotated-session'))).toBe(true)
    if (path === '/login') expect(JSON.parse(calls[0]!.body).params.db).toBe('liwan_scratch_dedicated_auth')
  })

  it('browser release selectors cannot replace the server-installed generation pin', async () => {
    const response = await request('/login', { 'x-liwan-release-pool': 'green', 'x-liwan-release-revision': '999', 'x-liwan-release-fence': '999' })
    expect(response.status).toBe(200)
    expect(calls[0]?.headers).toMatchObject(pin)
  })

  it('auth headers preserve the release binding even without a legacy client-IP option', async () => {
    const response = await request('/headers')
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ host, 'x-liwan-proxy-token': token, 'x-liwan-tenant-revision': '2', ...pin })
  })

  it('commercial actor lookup uses the bound session but keeps the dedicated configured tenant identity', async () => {
    const response = await request('/principal')
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ actor_id: '7', tenant_id: 'dedicated-config-tenant', kind: 'customer', capabilities: ['subscription.read'] })
    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({ path: '/api/v1/me', headers: { host, ...pin, 'x-liwan-proxy-token': token, cookie: 'session_id=existing-session' } })
  })

  it.each(['/login', '/totp', '/logout', '/principal'])('%s rejects an untrusted dedicated proxy before contacting Odoo', async (path) => {
    expect((await request(path, { 'x-liwan-proxy-token': 'forged' })).status).toBe(403)
    expect(calls).toEqual([])
  })

  it('bound logout does not claim success or clear the browser session after upstream failure', async () => {
    failure = true
    const response = await request('/logout')
    expect(response.status).toBe(502)
    expect(response.headers.getSetCookie()).toEqual([])
  })

  it('unbound logout fails when Odoo does not destroy the session', async () => {
    vi.stubEnv('LIWAN_RELEASE_ROUTES_DIR', '')
    failure = true
    const response = await request('/logout')
    expect(response.status).toBe(502)
    expect((await response.json())).toMatchObject({ statusCode: 502, statusMessage: 'logout_failed' })
    expect(response.headers.getSetCookie()).toEqual([])
  })
})
