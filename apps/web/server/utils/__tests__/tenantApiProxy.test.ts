import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const transport = vi.hoisted(() => vi.fn().mockResolvedValue(new Response('{}')))
vi.mock('../tenantTransport', () => ({ tenantTransport: transport, boundedTenantBody: async () => undefined }))
vi.mock('h3', async importOriginal => ({ ...await importOriginal<typeof import('h3')>(), sendWebResponse: vi.fn() }))

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs() })

async function setup() {
  const proxy = vi.fn().mockResolvedValue({ ok: true })
  vi.stubGlobal('defineEventHandler', (handler: unknown) => handler)
  vi.stubGlobal('useRuntimeConfig', () => ({ odooUrl: 'http://guard:8080' }))
  vi.stubGlobal('proxyRequest', proxy)
  const { default: handler } = await import('../../routes/api/v1/[...path]')
  return { proxy, handler }
}

describe('API proxy tenancy mode separation', () => {
  it('preserves dedicated two-argument call without registry access', async () => {
    vi.stubEnv('WEBVUE_TENANCY_MODE', 'dedicated')
    const { proxy, handler } = await setup()
    const event = { path: '/api/v1/me' }
    await handler(event as never)
    expect(proxy).toHaveBeenCalledExactlyOnceWith(event, 'http://guard:8080/api/v1/me')
  })

  it('shared explicitly forwards trusted host, token and per-tenant revision', async () => {
    const path = join(mkdtempSync(join(tmpdir(), 'webvue-proxy-fixture-')), 'registry.json')
    writeFileSync(path, JSON.stringify({ schemaVersion: 1, snapshotRevision: 9, targets: [{ tenantId: 'tenant_a', host: 'alpha.example.test', database: 'db_a', filestore: 'db_a', enabled: true, registryRevision: 3 }] }))
    const token = 'synthetic-private-token-'.repeat(3)
    vi.stubEnv('WEBVUE_TENANCY_MODE', 'shared')
    vi.stubEnv('WEBVUE_SHARED_PROXY_TOKEN', token)
    vi.stubEnv('WEBVUE_TENANT_REGISTRY_PATH', path)
    const headers = { host: 'alpha.example.test', 'x-webvue-proxy-token': token, 'x-webvue-tenant-revision': '3' }
    const event = { path: '/api/v1/me', node: { req: { headers } } }
    const { proxy, handler } = await setup()
    await handler(event as never)
    expect(proxy).not.toHaveBeenCalled()
    expect(transport).toHaveBeenCalledWith(event, 'http://guard:8080', '/api/v1/me', { method: undefined, body: undefined })
    proxy.mockClear()
    event.node.req.headers['x-webvue-tenant-revision'] = '2'
    expect(() => handler(event as never)).toThrow('tenant_boundary_rejected')
    expect(proxy).not.toHaveBeenCalled()
  })

  it('unknown modes never fall back to dedicated forwarding', async () => {
    vi.stubEnv('WEBVUE_TENANCY_MODE', 'typo')
    const { proxy, handler } = await setup()
    expect(() => handler({ path: '/api/v1/me' } as never)).toThrow('invalid_tenancy_mode')
    expect(proxy).not.toHaveBeenCalled()
  })
})
