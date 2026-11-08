import { afterEach, describe, expect, it, vi } from 'vitest'
import { tenantRequest, tenantUpstreamHeaders } from '../tenantRequest'
import type { H3Event } from 'h3'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

afterEach(() => vi.unstubAllEnvs())
describe('explicit tenancy mode', () => {
  it('preserves dedicated behavior without needing a registry or token', () => {
    vi.stubEnv('LIWAN_TENANCY_MODE', 'dedicated')
    expect(tenantRequest({} as H3Event)).toBeNull()
    expect(tenantUpstreamHeaders({} as H3Event)).toEqual({})
  })
  it('rejects invalid modes rather than selecting a default database', () => {
    vi.stubEnv('LIWAN_TENANCY_MODE', 'typo')
    expect(() => tenantRequest({} as H3Event)).toThrow('invalid_tenancy_mode')
  })
  it('shared rejects calls without the trusted private hop', () => {
    vi.stubEnv('LIWAN_TENANCY_MODE', 'shared')
    expect(() => tenantRequest({ node: { req: { headers: { host: 'tenant.example.test' } } } } as unknown as H3Event)).toThrow('tenant_boundary_rejected')
  })
})

describe('restore hosts', () => {
  const token = 't'.repeat(40)
  const tenant = { host: 'tenant.example.test', tenantId: 'tenant', database: 'tenant_db', filestore: 'tenant_db', enabled: true, registryRevision: 1 }
  const restore = { host: `r${'1'.repeat(32)}.restore.example.test`, tenantId: `r${'1'.repeat(32)}`, database: 'liwan_scratch_one', filestore: 'liwan_scratch_one', enabled: true, registryRevision: 1 }
  const publish = (name: string, ...targets: object[]) => {
    const path = join(mkdtempSync(join(tmpdir(), 'liwan-restore-request-')), name)
    writeFileSync(path, JSON.stringify({ schemaVersion: 1, snapshotRevision: targets.length, targets }))
    return path
  }
  const requestFor = (host: string) => ({ context: {}, node: { req: { headers: { host, 'x-liwan-proxy-token': token, 'x-liwan-tenant-revision': '1' } } } }) as unknown as H3Event
  const setup = (restorePath?: string) => {
    vi.stubEnv('LIWAN_TENANCY_MODE', 'shared'); vi.stubEnv('LIWAN_SHARED_PROXY_TOKEN', token)
    vi.stubEnv('LIWAN_TENANT_REGISTRY_PATH', publish('registry.json', tenant))
    if (restorePath !== undefined) vi.stubEnv('LIWAN_RESTORE_REGISTRY_PATH', restorePath)
  }
  it('resolves a restore host from the restore registry and a tenant host from the tenant registry', () => {
    setup(publish('registry.json', restore))
    expect(tenantRequest(requestFor(restore.host))?.database).toBe('liwan_scratch_one')
    expect(tenantRequest(requestFor(tenant.host))?.database).toBe('tenant_db')
  })
  it('refuses a restore host when no restore registry is configured or its file is missing', () => {
    setup()
    expect(() => tenantRequest(requestFor(restore.host))).toThrow('tenant_boundary_rejected')
    setup(join(tmpdir(), 'liwan-restore-request-missing', 'registry.json'))
    expect(() => tenantRequest(requestFor(restore.host))).toThrow('tenant_boundary_rejected')
  })
  it('never lets the restore registry answer a host outside the restore namespace', () => {
    setup(publish('registry.json', { ...restore, host: 'other.example.test' }))
    expect(() => tenantRequest(requestFor('other.example.test'))).toThrow('tenant_boundary_rejected')
  })
})
