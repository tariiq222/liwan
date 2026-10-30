import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const proxyMock = vi.hoisted(() => vi.fn().mockResolvedValue(new Response('{}')))
const transport = vi.hoisted(() => vi.fn().mockResolvedValue(new Response('{}')))
vi.mock('../tenantTransport', () => ({ tenantTransport: transport, legacyTenantResponse: proxyMock, MAX_PUBLIC_MFA_BODY: 1024, MAX_PUBLIC_HOOK_BODY: 1024 * 1024, boundedTenantBody: async () => undefined, withTenantBody: async (_event: unknown, _scope: unknown, run: () => unknown) => run(), withTenantResponse: async (_event: unknown, _scope: unknown, run: () => unknown) => run(), withUpstreamSlot: async (run: (signal: AbortSignal) => unknown) => run(new AbortController().signal) }))
vi.mock('../apiSessionAdmission', () => ({ requireApiSession: async (event: { node: { req: { headers: { cookie?: string } } } }) => { if (!event.node.req.headers.cookie) { const error = Object.assign(new Error('session_required'), { statusCode: 401, data: { code: 'session_required' } }); throw error } } }))
vi.mock('h3', async importOriginal => ({ ...await importOriginal<typeof import('h3')>(), sendWebResponse: vi.fn(), sendProxy: (...args: unknown[]) => proxyMock(...args), getProxyRequestHeaders: () => ({}) }))

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs() })

async function setup() {
  const proxy = proxyMock; proxy.mockClear()
  vi.stubGlobal('defineEventHandler', (handler: unknown) => handler)
  vi.stubGlobal('useRuntimeConfig', () => ({ odooUrl: 'http://guard:8080' }))
  vi.stubGlobal('proxyRequest', proxy)
  const { default: handler } = await import('../../routes/api/v1/[...path]')
  return { proxy, handler }
}

describe('API proxy tenancy mode separation', () => {
  it('selects the bounded dedicated adapter without registry access', async () => {
    vi.stubEnv('WEBVUE_TENANCY_MODE', 'dedicated')
    const { proxy, handler } = await setup()
    const event = { path: '/api/v1/me', node: { req: { headers: { cookie: 'session_id=synthetic' } } } }
    await handler(event as never)
    expect(proxy).toHaveBeenCalledExactlyOnceWith(event, 'http://guard:8080', '/api/v1/me', { method: undefined, body: undefined, headers: {} })
  })

  it('shared explicitly forwards trusted host, token and per-tenant revision', async () => {
    const path = join(mkdtempSync(join(tmpdir(), 'webvue-proxy-fixture-')), 'registry.json')
    writeFileSync(path, JSON.stringify({ schemaVersion: 1, snapshotRevision: 9, targets: [{ tenantId: 'tenant_a', host: 'alpha.example.test', database: 'db_a', filestore: 'db_a', enabled: true, registryRevision: 3 }] }))
    const token = 'synthetic-private-token-'.repeat(3)
    vi.stubEnv('WEBVUE_TENANCY_MODE', 'shared')
    vi.stubEnv('WEBVUE_SHARED_PROXY_TOKEN', token)
    vi.stubEnv('WEBVUE_TENANT_REGISTRY_PATH', path)
    const headers = { host: 'alpha.example.test', 'x-webvue-proxy-token': token, 'x-webvue-tenant-revision': '3', cookie: 'session_id=synthetic' }
    const event = { path: '/api/v1/me', node: { req: { headers } } }
    const { proxy, handler } = await setup()
    await handler(event as never)
    expect(proxy).not.toHaveBeenCalled()
    expect(transport).toHaveBeenCalledWith(event, 'http://guard:8080', '/api/v1/me', { method: undefined, body: undefined })
    proxy.mockClear()
    event.node.req.headers['x-webvue-tenant-revision'] = '2'
    await expect(handler(event as never)).rejects.toThrow('tenant_boundary_rejected')
    expect(proxy).not.toHaveBeenCalled()
  })

  it('unknown modes never fall back to dedicated forwarding', async () => {
    vi.stubEnv('WEBVUE_TENANCY_MODE', 'typo')
    const { proxy, handler } = await setup()
    await expect(handler({ path: '/api/v1/me' } as never)).rejects.toThrow('invalid_tenancy_mode')
    expect(proxy).not.toHaveBeenCalled()
  })

  it('rejects anonymous requests before reading the body or holding a slot', async () => {
    vi.stubEnv('WEBVUE_TENANCY_MODE', 'dedicated')
    transport.mockClear()
    const { proxy, handler } = await setup()
    const event = { path: '/api/v1/me', node: { req: { headers: {} } } }
    let caught: unknown
    try { await handler(event as never) } catch (error) { caught = error }
    expect(caught).toHaveProperty('data.code', 'session_required')
    // The identity middleware recognizes 401 as logged out and must still render /login.
    expect(caught).toHaveProperty('statusCode', 401)
    expect(proxy).not.toHaveBeenCalled()
    expect(transport).not.toHaveBeenCalled()
  })

  it('still serves the public api paths without a session cookie', async () => {
    vi.stubEnv('WEBVUE_TENANCY_MODE', 'dedicated')
    const { proxy, handler } = await setup()
    const event = { path: '/api/v1/branding', method: 'GET', node: { req: { headers: {} } } }
    await handler(event as never)
    expect(proxy).toHaveBeenCalledExactlyOnceWith(event, 'http://guard:8080', '/api/v1/branding', { method: 'GET', body: undefined, headers: {} })
  })
})

describe('server-only API routes', () => {
  it.each(['POST', 'GET', 'PATCH'])('refuses %s /api/v1/ai/usage from a browser before any session check or dispatch', async (method) => {
    vi.stubEnv('WEBVUE_TENANCY_MODE', 'dedicated')
    transport.mockClear()
    const { proxy, handler } = await setup()
    for (const path of ['/api/v1/ai/usage', '/api/v1/ai/usage/', '/api/v1/ai/usage?x=1', '/api/v1/ai/%75sage']) {
      const event = { path, method, node: { req: { headers: { cookie: 'session_id=synthetic' } } } }
      await expect(handler(event as never)).rejects.toMatchObject({ statusCode: 404, data: { code: 'not_found' } })
    }
    expect(proxy).not.toHaveBeenCalled()
    expect(transport).not.toHaveBeenCalled()
  })

  it('still forwards the audit route, which the browser posts for approved drafts', async () => {
    vi.stubEnv('WEBVUE_TENANCY_MODE', 'dedicated')
    const { proxy, handler } = await setup()
    const event = { path: '/api/v1/ai/audit', method: 'POST', node: { req: { headers: { cookie: 'session_id=synthetic' } } } }
    await handler(event as never)
    expect(proxy).toHaveBeenCalledTimes(1)
  })
})

describe('public API namespace', () => {
  function sharedEvent(path: string, method: string, cookie?: string) {
    const registry = join(mkdtempSync(join(tmpdir(), 'webvue-proxy-public-')), 'registry.json')
    writeFileSync(registry, JSON.stringify({ schemaVersion: 1, snapshotRevision: 9, targets: [{ tenantId: 'tenant_a', host: 'alpha.example.test', database: 'db_a', filestore: 'db_a', enabled: true, registryRevision: 3 }] }))
    const token = 'synthetic-private-token-'.repeat(3)
    vi.stubEnv('WEBVUE_TENANCY_MODE', 'shared')
    vi.stubEnv('WEBVUE_SHARED_PROXY_TOKEN', token)
    vi.stubEnv('WEBVUE_TENANT_REGISTRY_PATH', registry)
    const headers: Record<string, string> = { host: 'alpha.example.test', 'x-webvue-proxy-token': token, 'x-webvue-tenant-revision': '3' }
    if (cookie) headers.cookie = cookie
    return { path, method, node: { req: { headers }, res: { setHeader: vi.fn(), getHeader: vi.fn() } } }
  }

  it('forwards without a session and without the browser cookie', async () => {
    transport.mockClear()
    const event = sharedEvent('/api/v1/public/payments/invoices/7?access_token=t', 'GET', 'session_id=staff')
    const { handler } = await setup()
    await handler(event as never)
    expect(transport).toHaveBeenCalledExactlyOnceWith(event, 'http://guard:8080', '/api/v1/public/payments/invoices/7?access_token=t', { method: 'GET', body: undefined, headers: { cookie: '' } })
  })

  it('drops any cookie Odoo sets on a public answer', async () => {
    transport.mockResolvedValueOnce(new Response('{}', { headers: { 'set-cookie': 'session_id=fresh; Path=/' } }))
    const { sendWebResponse } = await import('h3')
    const send = vi.mocked(sendWebResponse); send.mockClear()
    const { handler } = await setup()
    await handler(sharedEvent('/api/v1/public/payments/invoices/7?access_token=t', 'GET') as never)
    expect(send.mock.calls[0]![1].headers.get('set-cookie')).toBeNull()
  })

  it('accepts only GET, HEAD and POST', async () => {
    transport.mockClear()
    const { handler } = await setup()
    await expect(handler(sharedEvent('/api/v1/public/payments/invoices/7', 'PATCH') as never)).rejects.toMatchObject({ statusCode: 405 })
    expect(transport).not.toHaveBeenCalled()
  })

  it('does not treat a lookalike prefix as public', async () => {
    transport.mockClear()
    const { handler } = await setup()
    await expect(handler(sharedEvent('/api/v1/publicity', 'GET') as never)).rejects.toMatchObject({ statusCode: 401 })
    expect(transport).not.toHaveBeenCalled()
  })
})
