import { afterEach, describe, expect, it, vi } from 'vitest'
import { tenantRequest, tenantUpstreamHeaders } from '../tenantRequest'
import type { H3Event } from 'h3'

afterEach(() => vi.unstubAllEnvs())
describe('explicit tenancy mode', () => {
  it('preserves dedicated behavior without needing a registry or token', () => {
    vi.stubEnv('NASQ_TENANCY_MODE', 'dedicated')
    expect(tenantRequest({} as H3Event)).toBeNull()
    expect(tenantUpstreamHeaders({} as H3Event)).toEqual({})
  })
  it('rejects invalid modes rather than selecting a default database', () => {
    vi.stubEnv('NASQ_TENANCY_MODE', 'typo')
    expect(() => tenantRequest({} as H3Event)).toThrow('invalid_tenancy_mode')
  })
  it('shared rejects calls without the trusted private hop', () => {
    vi.stubEnv('NASQ_TENANCY_MODE', 'shared')
    expect(() => tenantRequest({ node: { req: { headers: { host: 'tenant.example.test' } } } } as unknown as H3Event)).toThrow('tenant_boundary_rejected')
  })
})
