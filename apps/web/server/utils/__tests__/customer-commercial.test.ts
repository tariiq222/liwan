import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { verifyServiceRequest } from '@webvue/commercial-contracts/server'
import { assertCustomerMutationOrigin, assertNoForgedFields, csrfMatches, customerCommercialEnabled, customerRoute, allowPaymentReturn, forwardCustomerRequest, issueCsrfCookie, PAYMENT_RETURN_LIMITS, paymentReturnStoreSize, rateLimitMutation, relayPaymentReturn, resetRateLimitForTests, signedBodyFor } from '../customer-commercial'
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
  it('keeps the control-plane refusal code on a 409', async () => {
    const raw = setup({ url: 'https://acme.example/api/commercial/v1/trial', method: 'POST', body: '{"plan_id":"p"}' })
    raw.mockRejectedValueOnce(Object.assign(new Error('refused'), { statusCode: 409, data: { code: 'tenant_upgrade_required', message: 'tenant needs an upgrade' } }))
    await expect(forwardCustomerRequest({} as never)).rejects.toMatchObject({ statusCode: 409, data: { code: 'tenant_upgrade_required' } })
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
    expect(customerRoute('POST', 'preview')).toEqual({ upstream: '/v1/customer/preview', needs: 'subscription.read' })
    expect(customerRoute('POST', 'trial')).toEqual({ upstream: '/v1/customer/trial', needs: 'subscription.manage' })
    expect(customerRoute('POST', 'trial/convert')).toEqual({ upstream: '/v1/customer/trial/convert', needs: 'subscription.manage' })
    expect(customerRoute('POST', 'orders/abc/payment-attempts')?.needs).toBe('subscription.manage')
    expect(customerRoute('POST', 'orders/abc/cancel')?.needs).toBe('subscription.manage')
    expect(customerRoute('GET', 'orders/abc/cancel')).toBeNull()
    expect(customerRoute('GET', 'orders/abc')).toEqual({ upstream: '/v1/customer/orders/abc', needs: 'subscription.read' })
    expect(customerRoute('POST', 'orders/abc')).toBeNull()
    expect(customerRoute('GET', 'orders/abc/payment-attempts')).toBeNull()
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

describe('payment return relay', () => {
  const ATTEMPT = '3f2b8c1e-5d4a-4b7e-9c10-2a6d8e0f1b34'
  const ORDER = '9a7c5e3b-1d2f-4a6b-8c0e-4f2a6b8d0c1e'
  const returnSetup = (opts: { method?: string; attempt?: string; cfg?: Record<string, unknown> } = {}) => {
    const raw = setup({ method: opts.method ?? 'GET', url: `https://acme.example/api/commercial/payment-callback?attempt=${opts.attempt ?? ATTEMPT}`, cookies: {}, headers: { cookie: '' }, cfg: opts.cfg })
    raw.mockResolvedValue({ status: 200, _data: { order_id: ORDER, payment_state: 'paid', fulfillment_state: 'queued' } })
    const status = vi.fn(); const headers: Record<string, string> = {}
    vi.stubGlobal('setResponseStatus', status)
    vi.stubGlobal('setResponseHeader', (_e: unknown, n: string, v: string) => { headers[n] = v })
    return { raw, status, headers }
  }
  it('sends a browser return to the order status after an anonymous signed lookup', async () => {
    const { raw, status, headers } = returnSetup()
    expect(await relayPaymentReturn({} as never)).toBe('')
    expect(status).toHaveBeenLastCalledWith({}, 303)
    expect(headers).toMatchObject({ location: `/subscription/status?order=${ORDER}`, 'cache-control': 'no-store' })
    const [url, init] = raw.mock.calls[0]!
    expect(url).toBe(`https://control.example/v1/customer/payment-returns/${ATTEMPT}`)
    expect(init).toMatchObject({ method: 'POST', redirect: 'error' })
    expect(init.signal).toBeInstanceOf(AbortSignal)
    const h = init.headers as Record<string, string>
    expect(h).not.toHaveProperty('cookie'); expect(h).not.toHaveProperty('x-webvue-principal')
    expect(h['x-webvue-tenant']).toBe('tenant-acme')
    const verify = (key: string, tenant: string) => verifyServiceRequest({ method: 'POST', path: `/v1/customer/payment-returns/${ATTEMPT}`, body: `webvue-payment-return:${tenant}\n`, key, headers: h, anonymous: true })
    expect(verify(KEY, 'tenant-acme')).toMatchObject({ actor: 'anonymous', issuer: 'customer-web' })
    expect(verify(KEY, 'tenant-other')).toBeNull()
    expect(verify('x'.repeat(48), 'tenant-acme')).toBeNull()
  })
  it.each(['not-a-uuid', '', '../x'])('makes no control-plane call for the attempt %j', async attempt => {
    const { raw, headers } = returnSetup({ attempt })
    await relayPaymentReturn({} as never)
    expect(raw).not.toHaveBeenCalled()
    expect(headers.location).toBe('/subscription')
  })
  it('falls back to the subscription page when the control plane fails or answers nonsense', async () => {
    const failed = returnSetup(); failed.raw.mockRejectedValue(Object.assign(new Error('down'), { statusCode: 503 }))
    await relayPaymentReturn({} as never)
    expect(failed.headers.location).toBe('/subscription')
    const odd = returnSetup(); odd.raw.mockResolvedValue({ status: 200, _data: { order_id: '/evil' } })
    await relayPaymentReturn({} as never)
    expect(odd.headers.location).toBe('/subscription')
  })
  it('answers a provider POST with 204 and never reads the body', async () => {
    const { raw, status } = returnSetup({ method: 'POST' })
    const read = vi.fn(); vi.stubGlobal('readRawBody', read)
    expect(await relayPaymentReturn({} as never)).toBe('')
    expect(status).toHaveBeenLastCalledWith({}, 204)
    expect(raw).toHaveBeenCalledTimes(1)
    expect(read).not.toHaveBeenCalled()
  })
  it('is 404 when the commercial feature is disabled, 405 for other methods, and rate-limited per attempt', async () => {
    const off = returnSetup({ cfg: { customerCommercialEnabled: false } })
    await expect(relayPaymentReturn({} as never)).rejects.toMatchObject({ statusCode: 404 })
    expect(off.raw).not.toHaveBeenCalled()
    const put = returnSetup({ method: 'PUT' })
    await relayPaymentReturn({} as never)
    expect(put.status).toHaveBeenLastCalledWith({}, 405)
    const limited = returnSetup()
    for (let i = 0; i < 25; i++) await relayPaymentReturn({} as never)
    expect(limited.raw).toHaveBeenCalledTimes(PAYMENT_RETURN_LIMITS.perAttempt)
  })
  it('uses the verified host binding as the tenant in shared mode', async () => {
    const { raw } = returnSetup()
    vi.mocked(tenantRequest).mockReturnValueOnce({ tenantId: 'registry-tenant', host: 'acme.example' } as never)
    await relayPaymentReturn({} as never)
    expect((raw.mock.calls[0]![1].headers as Record<string, string>)['x-webvue-tenant']).toBe('registry-tenant')
  })
  it('limits a client that sends a fresh attempt id every time, without touching the signed-in buckets', async () => {
    const { raw } = returnSetup({ attempt: '00000000-0000-4000-8000-000000000000' })
    for (let i = 0; i < 10; i++) rateLimitMutation('signed-in-user') // an unrelated signed-in session
    const ids = Array.from({ length: PAYMENT_RETURN_LIMITS.perClient + 20 }, (_, n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`)
    for (const id of ids) {
      setup({ method: 'GET', url: `https://acme.example/api/commercial/payment-callback?attempt=${id}`, headers: { cookie: '', 'x-webvue-client-ip': '203.0.113.9' } })
      vi.stubGlobal('$fetch', Object.assign(vi.fn(), { raw }))
      vi.stubGlobal('setResponseStatus', vi.fn()); vi.stubGlobal('setResponseHeader', vi.fn())
      await relayPaymentReturn({} as never)
    }
    expect(raw).toHaveBeenCalledTimes(PAYMENT_RETURN_LIMITS.perClient)
    // The shared mutation store still holds the session with its own count: 10 used, 10 left of 20.
    for (let i = 0; i < 10; i++) expect(rateLimitMutation('signed-in-user')).toBe(true)
    expect(rateLimitMutation('signed-in-user')).toBe(false)
  })
  it('keeps the payment return store bounded, evicts oldest first, and caps the whole route', () => {
    const now = 1_000_000
    for (let i = 0; i < PAYMENT_RETURN_LIMITS.maxKeys * 2; i++) allowPaymentReturn(`t|10.0.${i % 250}.${i}`, `t|${i}`, now + i * 1000)
    expect(paymentReturnStoreSize()).toBeLessThanOrEqual(PAYMENT_RETURN_LIMITS.maxKeys)
    resetRateLimitForTests()
    let allowed = 0
    for (let i = 0; i < PAYMENT_RETURN_LIMITS.global + 50; i++) if (allowPaymentReturn(`t|client${i}`, `t|attempt${i}`, now)) allowed++
    expect(allowed).toBe(PAYMENT_RETURN_LIMITS.global)
    expect(allowPaymentReturn('t|client-late', 't|attempt-late', now + PAYMENT_RETURN_LIMITS.windowMs + 1)).toBe(true)
  })
  it('logs a short reason without the attempt id when the lookup fails', async () => {
    const { raw } = returnSetup(); raw.mockRejectedValue(Object.assign(new Error('x'), { statusCode: 502 }))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await relayPaymentReturn({} as never)
    expect(warn).toHaveBeenCalledWith('[payment-return] lookup failed: http 502')
    expect(JSON.stringify(warn.mock.calls)).not.toContain(ATTEMPT)
    warn.mockRestore()
  })
})

describe('issueCsrfCookie', () => {
  it('sets the double-submit cookie on a browser-side GET when none exists and answers 204', () => {
    setup({ cookies: { webvue_csrf: '' } })
    expect(issueCsrfCookie({} as never)).toBeNull()
    expect(setCookie).toHaveBeenCalledWith(expect.anything(), 'webvue_csrf', expect.stringMatching(/^[0-9a-f]{48}$/), expect.objectContaining({ httpOnly: false, sameSite: 'strict' }))
    expect(setResponseStatus).toHaveBeenCalledWith(expect.anything(), 204)
    expect(setResponseHeader).toHaveBeenCalledWith(expect.anything(), 'Cache-Control', 'no-store')
  })
  it('keeps an existing cookie and answers 404 when subscriptions are off', () => {
    setup()
    issueCsrfCookie({} as never)
    expect(setCookie).not.toHaveBeenCalled()
    setup({ cfg: { customerCommercialEnabled: false } })
    expect(() => issueCsrfCookie({} as never)).toThrow()
  })
})
