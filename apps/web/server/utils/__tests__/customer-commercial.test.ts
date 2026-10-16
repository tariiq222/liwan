import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { verifyServiceRequest } from '@webvue/commercial-contracts/server'
import { assertCustomerMutationOrigin, assertNoForgedFields, csrfMatches, customerCommercialEnabled, customerRoute, forwardCustomerRequest, rateLimitMutation, resetRateLimitForTests, signedBodyFor } from '../customer-commercial'
import { deriveCustomerCapabilities } from '../../../app/utils/customerCapabilities'

vi.mock('../tenantRequest', async (orig) => {
  const actual = await orig<typeof import('../tenantRequest')>()
  return { ...actual, tenantRequest: vi.fn(actual.tenantRequest) }
})
import { tenantRequest } from '../tenantRequest'

const KEY = 'k'.repeat(48)
const CSRF = 'c'.repeat(40)
const config = { customerCommercialEnabled: true, customerCommercialControlUrl: 'https://control.example', customerCommercialServiceKey: KEY, customerCommercialIssuer: 'customer-web', customerCommercialPublicOrigin: 'https://acme.example', customerCommercialTenantId: 'tenant-acme', odooUrl: 'https://odoo.example' }
const me = (capabilities: string[]) => ({ id: 7, name: 'U', login: 'u', email: '', lang: 'ar_001', tz: 'UTC', role: 'employee', capabilities, company: { id: 1, name: 'C' } })

function setup(opts: { method?: string; url?: string; body?: string; headers?: Record<string, string>; cookies?: Record<string, string>; caps?: string[]; cfg?: Record<string, unknown> } = {}) {
  const headers: Record<string, string> = { cookie: 'session_id=s', origin: 'https://acme.example', 'content-type': 'application/json', 'x-webvue-csrf': CSRF, ...opts.headers }
  const cookies: Record<string, string> = { webvue_csrf: CSRF, ...opts.cookies }
  vi.stubGlobal('useRuntimeConfig', () => ({ ...config, ...opts.cfg }))
  vi.stubGlobal('getMethod', () => opts.method ?? 'GET')
  vi.stubGlobal('getHeader', (_e: unknown, n: string) => headers[n])
  vi.stubGlobal('getCookie', (_e: unknown, n: string) => cookies[n])
  vi.stubGlobal('setCookie', vi.fn())
  vi.stubGlobal('getRequestURL', () => new URL(opts.url ?? 'https://acme.example/api/commercial/v1/subscription'))
  vi.stubGlobal('readRawBody', async () => opts.body)
  vi.stubGlobal('setResponseStatus', vi.fn())
  vi.stubGlobal('setResponseHeader', vi.fn())
  vi.stubGlobal('createError', (e: { statusCode: number; data: unknown }) => Object.assign(new Error(), e))
  const raw = vi.fn().mockResolvedValue({ status: 200, _data: { ok: true } })
  vi.stubGlobal('$fetch', Object.assign(vi.fn().mockResolvedValue(me(opts.caps ?? ['settings.branding.manage'])), { raw }))
  return raw
}
beforeEach(() => resetRateLimitForTests())
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })

describe('capability mapping', () => {
  it('settings administrators get the full customer set; settings readers read only; others nothing', () => {
    expect(deriveCustomerCapabilities(['settings.branding.manage'])).toEqual(['subscription.read', 'subscription.manage', 'branches.manage', 'billing.read'])
    expect(deriveCustomerCapabilities(['access.roles.manage'])).toContain('billing.read')
    expect(deriveCustomerCapabilities(['access.users.read'])).toEqual(['subscription.read'])
    expect(deriveCustomerCapabilities(['pmo.tasks.read', 'hr.employees.manage'])).toEqual([])
    expect(deriveCustomerCapabilities(undefined)).toEqual([])
  })
})

describe('customer commercial BFF', () => {
  it('is 404 when disabled and never calls upstream', async () => {
    const raw = setup({ cfg: { customerCommercialEnabled: false } })
    expect(customerCommercialEnabled({ customerCommercialEnabled: 'false' })).toBe(false)
    await expect(forwardCustomerRequest({} as never)).rejects.toMatchObject({ statusCode: 404 })
    expect(raw).not.toHaveBeenCalled()
  })
  it('derives the principal server-side and signs it into the request', async () => {
    const raw = setup()
    expect(await forwardCustomerRequest({} as never)).toEqual({ ok: true })
    const [url, init] = raw.mock.calls[0]!
    expect(url).toBe('https://control.example/v1/customer/subscription')
    const h = init.headers as Record<string, string>
    expect(h).not.toHaveProperty('cookie')
    const principal = JSON.parse(Buffer.from(h['x-webvue-principal']!, 'base64').toString())
    expect(principal).toEqual({ actor_id: '7', kind: 'customer', tenant_id: 'tenant-acme', capabilities: ['subscription.read', 'subscription.manage', 'branches.manage', 'billing.read'] })
    const ok = verifyServiceRequest({ method: 'GET', path: '/v1/customer/subscription', body: signedBodyFor(h['x-webvue-principal']!, undefined), key: KEY, headers: h })
    expect(ok).toMatchObject({ actor: 7, issuer: 'customer-web' })
    // Tampering with the principal invalidates the signature.
    const forged = Buffer.from(JSON.stringify({ ...principal, tenant_id: 'tenant-other' })).toString('base64')
    expect(verifyServiceRequest({ method: 'GET', path: '/v1/customer/subscription', body: signedBodyFor(forged, undefined), key: KEY, headers: h })).toBeNull()
  })
  it('rejects forged tenant/customer/capability fields in query and body with 400', async () => {
    const raw = setup({ url: 'https://acme.example/api/commercial/v1/usage?tenant_id=other' })
    await expect(forwardCustomerRequest({} as never)).rejects.toMatchObject({ statusCode: 400, data: { code: 'forbidden_field' } })
    setup({ method: 'POST', url: 'https://acme.example/api/commercial/v1/quotes', body: JSON.stringify({ kind: 'new', nested: { customer_id: 'x' } }) })
    await expect(forwardCustomerRequest({} as never)).rejects.toMatchObject({ statusCode: 400 })
    setup({ method: 'POST', url: 'https://acme.example/api/commercial/v1/quotes', body: JSON.stringify({ capabilities: ['subscription.manage'] }) })
    await expect(forwardCustomerRequest({} as never)).rejects.toMatchObject({ statusCode: 400 })
    expect(raw).not.toHaveBeenCalled()
    expect(() => assertNoForgedFields({ a: [{ Tenant_ID: 1 }] })).toThrow()
  })
  it('requires CSRF header = cookie, JSON, and same origin for mutations', async () => {
    const body = JSON.stringify({ kind: 'new' })
    const url = 'https://acme.example/api/commercial/v1/quotes'
    setup({ method: 'POST', url, body, headers: { 'x-webvue-csrf': 'z'.repeat(40) } })
    await expect(forwardCustomerRequest({} as never)).rejects.toMatchObject({ statusCode: 403, data: { code: 'csrf_failed' } })
    setup({ method: 'POST', url, body, headers: { origin: 'https://evil.example' } })
    await expect(forwardCustomerRequest({} as never)).rejects.toMatchObject({ statusCode: 403, data: { code: 'cross_site_request' } })
    setup({ method: 'POST', url, body, headers: { 'sec-fetch-site': 'cross-site' } })
    await expect(forwardCustomerRequest({} as never)).rejects.toMatchObject({ statusCode: 403 })
    setup({ method: 'POST', url, body, headers: { 'content-type': 'text/plain' } })
    await expect(forwardCustomerRequest({} as never)).rejects.toMatchObject({ statusCode: 415 })
    const raw = setup({ method: 'POST', url, body })
    await forwardCustomerRequest({} as never)
    expect(raw.mock.calls[0]![1].body).toBe(body)
    expect(csrfMatches(CSRF, CSRF)).toBe(true); expect(csrfMatches('short', 'short')).toBe(false)
  })
  it('enforces capabilities per route before calling upstream', async () => {
    const raw = setup({ method: 'POST', url: 'https://acme.example/api/commercial/v1/orders', body: '{"quote_id":"q"}', caps: ['access.users.read'] })
    await expect(forwardCustomerRequest({} as never)).rejects.toMatchObject({ statusCode: 403 })
    setup({ url: 'https://acme.example/api/commercial/v1/invoices', caps: ['access.users.read'] })
    await expect(forwardCustomerRequest({} as never)).rejects.toMatchObject({ statusCode: 403 })
    setup({ caps: ['pmo.tasks.read'] })
    await expect(forwardCustomerRequest({} as never)).rejects.toMatchObject({ statusCode: 403 })
    expect(raw).not.toHaveBeenCalled()
  })
  it('only forwards the documented customer routes', () => {
    expect(customerRoute('GET', 'subscription')?.upstream).toBe('/v1/customer/subscription')
    expect(customerRoute('POST', 'orders/abc/payment-attempts')?.needs).toBe('subscription.manage')
    expect(customerRoute('GET', 'invoices/inv-1')?.needs).toBe('billing.read')
    expect(customerRoute('POST', 'branch-quotes')?.needs).toBe('branches.manage')
    expect(customerRoute('GET', '../vendor/plans')).toBeNull()
    expect(customerRoute('GET', 'invoices/a/../b')).toBeNull()
    expect(customerRoute('DELETE', 'subscription')).toBeNull()
    expect(customerRoute('GET', 'admin')).toBeNull()
  })
  it('rate-limits mutations per session', () => {
    for (let i = 0; i < 20; i++) expect(rateLimitMutation('s', 1000)).toBe(true)
    expect(rateLimitMutation('s', 1001)).toBe(false)
    expect(rateLimitMutation('other', 1001)).toBe(true)
    expect(rateLimitMutation('s', 62_000)).toBe(true)
  })
})

describe('mutation origin binding', () => {
  const shared = (host: string) => vi.mocked(tenantRequest).mockReturnValue({ host, tenantId: 't', database: 'd', filestore: 'f', registryRevision: 1 } as never)
  afterEach(() => vi.mocked(tenantRequest).mockReset().mockImplementation(((await_: unknown) => null) as never))
  it('shared: accepts the tenant origin on its own host', () => {
    setup({ headers: { origin: 'https://ta1.example.test' } }); shared('ta1.example.test')
    expect(() => assertCustomerMutationOrigin({} as never, config)).not.toThrow()
  })
  it("shared: rejects A's origin on B's host", () => {
    setup({ headers: { origin: 'https://ta1.example.test' } }); shared('tb2.example.test')
    expect(() => assertCustomerMutationOrigin({} as never, config)).toThrow()
  })
  it('shared: rejects a forged origin, even the configured dedicated one', () => {
    setup({ headers: { origin: 'https://acme.example' } }); shared('ta1.example.test')
    expect(() => assertCustomerMutationOrigin({} as never, config)).toThrow()
  })
  it('dedicated: unchanged, uses the configured origin and 503 when absent', () => {
    setup(); vi.mocked(tenantRequest).mockReturnValue(null)
    expect(() => assertCustomerMutationOrigin({} as never, config)).not.toThrow()
    expect(() => assertCustomerMutationOrigin({} as never, { ...config, customerCommercialPublicOrigin: '' })).toThrow(expect.objectContaining({ statusCode: 503 }))
  })
})
