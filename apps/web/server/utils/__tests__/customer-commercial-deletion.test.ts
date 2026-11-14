import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { verifyServiceRequest } from '@liwan/commercial-contracts/server'
import { customerRoute, forwardCustomerRequest, resetRateLimitForTests, signedBodyFor } from '../customer-commercial'
import { deriveCustomerCapabilities } from '../../../app/utils/customerCapabilities'

vi.mock('../tenantRequest', async (orig) => ({ ...(await orig<typeof import('../tenantRequest')>()), tenantRequest: vi.fn(() => undefined) }))
vi.mock('../tenantTransport', async original => ({
  ...(await original<typeof import('../tenantTransport')>()), boundedTenantBody: vi.fn(), withTenantBody: async (_event: unknown, _scope: unknown, run: () => unknown) => run(),
}))
import { boundedTenantBody } from '../tenantTransport'

const KEY = 'k'.repeat(48)
const CSRF = 'c'.repeat(40)
const config = { customerCommercialEnabled: true, customerCommercialControlUrl: 'https://control.example', customerCommercialServiceKey: KEY, customerCommercialIssuer: 'customer-web', customerCommercialPublicOrigin: 'https://acme.example', customerCommercialTenantId: 'tenant-acme', odooUrl: 'https://odoo.example' }
const me = (capabilities: string[]) => ({ id: 7, name: 'U', login: 'u', email: '', lang: 'ar_001', tz: 'UTC', role: 'employee', capabilities, home_capabilities: capabilities, company: { id: 1, name: 'C' }, companies: [{ id: 1, name: 'C' }], home_company_id: 1 })
const MANAGER = ['settings.branding.manage', 'access.roles.manage']
const ADMIN = [...MANAGER, 'settings.company.vat.manage']

function setup(opts: { method: string; rest: string; body?: string; caps: string[]; ip?: string }) {
  const headers: Record<string, string | undefined> = { cookie: 'session_id=s', origin: 'https://acme.example', 'content-type': 'application/json', 'x-liwan-csrf': CSRF, 'x-liwan-client-ip': opts.ip }
  vi.stubGlobal('useRuntimeConfig', () => config)
  vi.stubGlobal('getMethod', () => opts.method)
  vi.stubGlobal('getHeader', (_e: unknown, n: string) => headers[n])
  vi.stubGlobal('getCookie', (_e: unknown, n: string) => ({ liwan_csrf: CSRF })[n])
  vi.stubGlobal('setCookie', vi.fn())
  vi.stubGlobal('getRequestURL', () => new URL(`https://acme.example/api/commercial/v1/${opts.rest}`))
  vi.mocked(boundedTenantBody).mockResolvedValue(opts.body === undefined ? undefined : Buffer.from(opts.body))
  vi.stubGlobal('setResponseStatus', vi.fn())
  vi.stubGlobal('setResponseHeader', vi.fn())
  vi.stubGlobal('createError', (e: { statusCode: number; data: unknown }) => Object.assign(new Error(), e))
  const raw = vi.fn().mockResolvedValue({ status: 200, _data: { deletion: null } })
  vi.stubGlobal('$fetch', Object.assign(vi.fn().mockResolvedValue(me(opts.caps)), { raw }))
  return raw
}

describe('tenant.delete in the customer BFF', () => {
  beforeEach(() => resetRateLimitForTests())
  afterEach(() => vi.unstubAllGlobals())

  it('is derived from the system administrator capability only, on top of the manager capabilities', () => {
    expect(deriveCustomerCapabilities(ADMIN)).toContain('tenant.delete')
    expect(deriveCustomerCapabilities(MANAGER)).not.toContain('tenant.delete')
    expect(deriveCustomerCapabilities(['settings.branding.manage'])).not.toContain('tenant.delete')
    expect(deriveCustomerCapabilities(['access.roles.manage', 'access.users.read'])).not.toContain('tenant.delete')
    // The VAT capability alone is not a manager: the deletion screen also needs the subscription capabilities.
    expect(deriveCustomerCapabilities(['settings.company.vat.manage'])).toEqual([])
    expect(deriveCustomerCapabilities(undefined)).toEqual([])
  })

  it('allows only the four deletion routes and ties each write to tenant.delete', () => {
    expect(customerRoute('GET', 'deletion')).toEqual({ upstream: '/v1/customer/deletion', needs: 'subscription.read' })
    for (const step of ['request', 'confirm', 'withdraw']) expect(customerRoute('POST', `deletion/${step}`)).toEqual({ upstream: `/v1/customer/deletion/${step}`, needs: 'tenant.delete' })
    for (const [method, rest] of [['POST', 'deletion'], ['GET', 'deletion/request'], ['DELETE', 'deletion'], ['PUT', 'deletion/confirm'], ['POST', 'deletion/shorten'], ['POST', 'deletion/confirm/../request']] as const)
      expect(customerRoute(method, rest)).toBeNull()
  })

  it('refuses a subscription manager who is not the system administrator before anything reaches the control plane', async () => {
    const raw = setup({ method: 'POST', rest: 'deletion/request', body: '{}', caps: MANAGER })
    await expect(forwardCustomerRequest({} as never)).rejects.toMatchObject({ statusCode: 403 })
    expect(raw).not.toHaveBeenCalled()
  })

  it('forwards the administrator with the edge-observed client address signed into the request, and drops an address that is not one', async () => {
    const raw = setup({ method: 'POST', rest: 'deletion/request', body: '{}', caps: ADMIN, ip: '203.0.113.9' })
    await forwardCustomerRequest({} as never)
    const sent = raw.mock.calls[0]![1].headers as Record<string, string>
    expect(sent['x-liwan-client-ip']).toBe('203.0.113.9')
    const verify = (address?: string) => verifyServiceRequest({ method: 'POST', path: '/v1/customer/deletion/request', body: signedBodyFor(sent['x-liwan-principal']!, '{}', address), key: 'k'.repeat(48), headers: sent as never })
    expect(verify('203.0.113.9')).not.toBeNull()
    // A different address, or none, is not what was signed.
    expect(verify('198.51.100.1')).toBeNull()
    expect(verify()).toBeNull()
    const other = setup({ method: 'POST', rest: 'deletion/request', body: '{}', caps: ADMIN, ip: 'not-an-address' })
    await forwardCustomerRequest({} as never)
    expect(other.mock.calls[0]![1].headers).not.toHaveProperty('x-liwan-client-ip')
    // No other route forwards it.
    const cancel = setup({ method: 'POST', rest: 'subscription/cancel', body: '{}', caps: ADMIN, ip: '203.0.113.9' })
    await forwardCustomerRequest({} as never)
    expect(cancel.mock.calls[0]![1].headers).not.toHaveProperty('x-liwan-client-ip')
  })

  it('lets any subscription reader see the countdown', async () => {
    const raw = setup({ method: 'GET', rest: 'deletion', caps: ['access.users.read'] })
    await forwardCustomerRequest({} as never)
    expect(raw).toHaveBeenCalledOnce()
  })
})
