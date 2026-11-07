import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import proxy from '../../api/vendor/v1/[...path]'
import { upstreamTimeoutMs } from '../proxy'
import { UPSTREAM_TIMEOUT_MS } from '../control'
import { at, SESSION, cookieHeader, json, send, stubConfig, stubUpstream } from './harness'

const get = (path: string, headers: Record<string, string> = cookieHeader()) => send(proxy, `/api/vendor/v1${path}`, { method: 'GET', headers })
const post = (path: string, sent: Parameters<typeof send>[2] = { body: { a: 1 } }) => send(proxy, `/api/vendor/v1${path}`, { headers: cookieHeader(), ...sent, ...(sent.headers ? { headers: { ...cookieHeader(), ...sent.headers } } : {}) })
const patch = (path: string, sent: Parameters<typeof send>[2] = { body: { a: 1 } }) => send(proxy, `/api/vendor/v1${path}`, { method: 'PATCH', headers: cookieHeader(), ...sent, ...(sent.headers ? { headers: { ...cookieHeader(), ...sent.headers } } : {}) })

describe('vendor API proxy', () => {
  beforeEach(() => stubConfig())
  afterEach(() => vi.unstubAllGlobals())

  it('answers 401 without a session cookie and calls nothing upstream', async () => {
    const calls = stubUpstream(() => json(200))
    expect(await get('/context', {})).toMatchObject({ status: 401, body: { code: 'unauthorized' } })
    expect(calls).toHaveLength(0)
  })

  it('treats a malformed cookie as no session', async () => {
    const calls = stubUpstream(() => json(200))
    expect((await get('/context', cookieHeader('garbage'))).status).toBe(401)
    expect(calls).toHaveLength(0)
  })

  it('forwards a cookie as is and the actor prefix equals the cookie account id', async () => {
    const other = `42.${'B'.repeat(43)}`
    const calls = stubUpstream(() => json(200, { ok: true }))
    expect((await get('/context', cookieHeader(other))).body).toEqual({ ok: true })
    expect(at(calls, 0).headers['x-liwan-session']).toBe(other)
    expect(at(calls, 0).headers['x-liwan-actor']).toBe('42')
  })

  it('passes the body bytes and the query through', async () => {
    const calls = stubUpstream(() => json(201, { id: 1 }))
    const result = await post('/commercial/plans?x=1', { body: { b: [1, 2] } })
    expect(result).toMatchObject({ status: 201, body: { id: 1 } })
    expect(at(calls, 0).body).toBe('{"b":[1,2]}')
    expect(at(calls, 0).url.search).toBe('?x=1')
    expect(at(calls, 0).headers['content-type']).toBe('application/json')
  })

  it('passes an upstream 403 step_up_required through unchanged', async () => {
    stubUpstream(() => json(403, { code: 'step_up_required' }))
    expect(await post('/commercial/plans')).toMatchObject({ status: 403, body: { code: 'step_up_required' } })
  })

  it('passes an upstream 403 forbidden through and keeps the session', async () => {
    stubUpstream(() => json(403, { code: 'forbidden' }))
    const result = await post('/commercial/orders')
    expect(result).toMatchObject({ status: 403, body: { code: 'forbidden' } })
    expect(result.headers.get('set-cookie')).toBeNull()
  })

  it('passes other upstream 4xx through, with a generic code when the body is not JSON', async () => {
    stubUpstream(() => json(409, { code: 'conflict' }))
    expect(await post('/commercial/plans')).toMatchObject({ status: 409, body: { code: 'conflict' } })
    stubUpstream(() => new Response('<html>', { status: 422 }))
    expect(await post('/commercial/plans')).toMatchObject({ status: 422, body: { code: 'vendor_request_failed' } })
  })

  it('answers an upstream 204 with no body', async () => {
    stubUpstream(() => json(204))
    expect(await post('/commercial/plans/1/publish')).toMatchObject({ status: 204, text: '' })
  })

  it('turns an upstream 5xx, a network failure and a redirect into 503 vendor_unavailable', async () => {
    stubUpstream(() => json(500, { detail: 'secret upstream text' }))
    const failed = await post('/commercial/plans')
    expect(failed).toMatchObject({ status: 503, body: { code: 'vendor_unavailable' } })
    expect(failed.text).not.toContain('secret')
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('boom')))
    expect(await get('/context')).toMatchObject({ status: 503, body: { code: 'vendor_unavailable' } })
  })

  it('clears the cookie on an upstream 401', async () => {
    stubUpstream(() => json(401, { code: 'unauthorized' }))
    const result = await get('/context')
    expect(result.status).toBe(401)
    expect(result.headers.get('set-cookie')).toMatch(/liwan_admin=;/)
  })

  it('rejects a body over 64 KiB with 413', async () => {
    const calls = stubUpstream(() => json(200))
    const rawBody = JSON.stringify({ pad: 'x'.repeat(64 * 1024) })
    expect(await post('/commercial/plans', { rawBody })).toMatchObject({ status: 413, body: { code: 'payload_too_large' } })
    expect(calls).toHaveLength(0)
  })

  it('rejects a body that is not a JSON object with 400', async () => {
    const calls = stubUpstream(() => json(200))
    for (const rawBody of ['[1]', 'null', '"x"', '{bad']) {
      expect(await post('/commercial/plans', { rawBody }), rawBody).toMatchObject({ status: 400, body: { code: 'invalid_json' } })
    }
    expect(calls).toHaveLength(0)
  })

  it('rejects a cross-site request with 403 cross_site_request', async () => {
    const calls = stubUpstream(() => json(200))
    expect(await post('/commercial/plans', { body: {}, headers: { 'sec-fetch-site': 'cross-site' } })).toMatchObject({ status: 403, body: { code: 'cross_site_request' } })
    expect(await post('/commercial/plans', { body: {}, headers: { origin: 'https://evil.example' } })).toMatchObject({ status: 403 })
    expect(calls).toHaveLength(0)
  })

  it('never reaches the sign-in surface or anything outside /v1/', async () => {
    const calls = stubUpstream(() => json(200))
    expect((await get('/admin/auth/logout')).status).toBe(404)
    expect((await send(proxy, '/api/vendor/other', { method: 'GET', headers: cookieHeader() })).status).toBe(404)
    expect((await send(proxy, '/api/vendor/v1/%2e%2e/admin', { method: 'GET', headers: cookieHeader() })).status).toBe(404)
    expect(calls).toHaveLength(0)
  })

  it('answers 404 for traversal and encoded-slash tricks aimed at the sign-in surface', async () => {
    const calls = stubUpstream(() => json(200))
    for (const path of ['/api/vendor/v1/x/../admin/auth/logout', '/api/vendor/v1/admin%2fauth/logout', '/api/vendor/v1/admin%2Fauth/logout', '/api/vendor/v1/%2e%2e/admin/auth/logout', '/api/vendor/v1/tenants/%2e%2e/%2e%2e/admin/auth/logout', '/api/vendor/v1/tenants\\..\\admin', '/api/vendor/v1//admin/auth/logout', '/api/vendor/v1/admin/auth/logout', '/api/vendor/v1/admin/auth/passkey/options']) {
      expect((await send(proxy, path, { method: 'GET', headers: cookieHeader() })).status, path).toBe(404)
    }
    expect(calls).toHaveLength(0)
  })

  it('forwards only the vendor surface the console uses', async () => {
    const calls = stubUpstream(() => json(200, {}))
    const allowed = ['/context', '/overview', '/targets', '/tenants', '/tenants/00000000-0000-4000-8000-000000000001/operations-grant', '/operations', '/catalog', '/audit', '/packages', '/packages/00000000-0000-4000-8000-000000000001', '/commercial/customers', '/commercial/customers/c-1', '/commercial/customers/c-1/trial', '/commercial/customers/c-1/invitations', '/commercial/attention', '/commercial/clients', '/commercial/orders', '/commercial/catalog/releases/r-1/default-bundles', '/commercial/orders/ab-1/cancel', '/commercial/orders/ab-1/payment-attempts', '/commercial/invoice-adjustments/a-1/refund', '/commercial/trials/s-1/extend', '/commercial/trials/s-1/end', '/commercial/subscriptions/s-1', '/commercial/subscriptions/s-1/usage', '/commercial/invoices/i-1', '/commercial/quotes', '/commercial/quotes/q-1', '/commercial/customer-terms', '/commercial/billing-settings', '/commercial/customer-quotes', '/commercial/catalog/releases', '/commercial/policies', '/commercial/plans/p-1/publish', '/commercial/bundles/b-1/revisions', '/shared/tenants/00000000-0000-4000-8000-000000000001/provisioning', '/platform/ai-provider', '/platform/ai-provider/presets', '/platform/ai-provider/models', '/platform/ai-provider/test', '/admin/me', '/admin/accounts', '/admin/accounts/12/roles']
    for (const path of allowed) expect((await get(path)).status, path).toBe(200)
    expect(calls).toHaveLength(allowed.length)
    const denied = ['/', '/registry/mutations', '/invitations/accept', '/admin', '/admin/accounts/x/roles', '/admin/accounts/12/other', '/admin/secret', '/internal/anything', '/tenantsx', '/contexts', '/packagesx', '/commercial', '/commercial/payment-events/moyasar', '/commercial/payment-simulator/a-1/settle', '/commercial/renewals/run', '/commercial/branch-quotes', '/commercial/customers/c-1/trial/x', '/commercial/attention/x', '/platform', '/platform/ai-provider/other', '/platform/ai-provider/models/x', '/platform/other', '/commercial/clients/c-1', '/commercial/orders/ab-1/other', '/commercial/invoice-adjustments/a-1', '/commercial/trials/s-1', '/commercial/trials/s-1/other', '/commercial/trials', '/commercial/invoice-adjustments/a-1/other', '/commercial/invoice-adjustments', '/commercial/plans/p-1/other', '/commercial/subscriptions/s-1/other', '/commercial/catalog', '/customer/orders', '/customer/invoices/i-1', '/invitations/accept']
    for (const path of denied) expect((await get(path)).status, path).toBe(404)
    expect(calls).toHaveLength(allowed.length)
  })

  it('forwards the release 1 billing routes and refuses their near misses', async () => {
    // A1: the console's settings page and its "confirm transfer" action need these exact paths, with these methods.
    const calls = stubUpstream(() => json(200, {}))
    expect((await get('/commercial/billing-settings')).status).toBe(200)
    expect((await patch('/commercial/billing-settings')).status).toBe(200)
    expect((await post('/commercial/invoices/00000000-0000-4000-8000-000000000001/bank-transfer')).status).toBe(200)
    expect(calls.map(c => `${c.method} ${c.url.pathname}`)).toEqual([
      'GET /v1/commercial/billing-settings',
      'PATCH /v1/commercial/billing-settings',
      'POST /v1/commercial/invoices/00000000-0000-4000-8000-000000000001/bank-transfer',
    ])
    // A near miss at either path is not the route: neither a settings subpath nor a second segment on the transfer.
    for (const path of ['/commercial/billing-settings/extra', '/commercial/billing-settings/x/y', '/commercial/billing-settingsx',
      '/commercial/invoices/i-1/bank-transfer/x', '/commercial/invoices/i-1/bank-transfers', '/commercial/invoices/i-1/refund']) {
      expect((await get(path)).status, path).toBe(404)
    }
    expect(calls).toHaveLength(3)
    // The method is part of the grant for these two routes, checked where the path is resolved (before any forwarding).
    const before = calls.length
    expect((await send(proxy, '/api/vendor/v1/commercial/invoices/00000000-0000-4000-8000-000000000001/bank-transfer', { method: 'GET', headers: cookieHeader() })).status).toBe(405)
    expect(calls).toHaveLength(before)
  })

  it('binds the method of the two release 1 billing routes', async () => {
    // Exercised through the real handler: the refusals must happen before anything is forwarded upstream.
    const calls = stubUpstream(() => json(200, {}))
    expect((await get('/commercial/billing-settings')).status).toBe(200)
    expect((await patch('/commercial/billing-settings')).status).toBe(200)
    expect((await post('/commercial/invoices/inv-1/bank-transfer')).status).toBe(200)
    const forwarded = calls.length
    // A method the console never uses on that path is refused, and never reaches the control plane.
    expect((await get('/commercial/invoices/inv-1/bank-transfer')).status).toBe(405)
    expect((await patch('/commercial/invoices/inv-1/bank-transfer')).status).toBe(405)
    expect(calls).toHaveLength(forwarded)
  })

  it('waits long enough for the AI provider probes (15 s models, two 20 s asks for a test) and keeps 10 s everywhere else', async () => {
    expect(upstreamTimeoutMs('/v1/platform/ai-provider/models')).toBeGreaterThan(15_000)
    expect(upstreamTimeoutMs('/v1/platform/ai-provider/test')).toBeGreaterThan(40_000)
    for (const path of ['/v1/platform/ai-provider', '/v1/platform/ai-provider/presets', '/v1/commercial/plans', '/v1/platform/ai-provider/models/x']) expect(upstreamTimeoutMs(path), path).toBe(UPSTREAM_TIMEOUT_MS)
    const timeouts: number[] = []
    const spy = vi.spyOn(AbortSignal, 'timeout').mockImplementation((ms: number) => { timeouts.push(ms); return new AbortController().signal })
    try {
      stubUpstream(() => json(200, { ok: true }))
      await post('/platform/ai-provider/models', { body: { preset: 'openai' } })
      await post('/platform/ai-provider/test', { body: { preset: 'openai', model: 'm' } })
      await get('/platform/ai-provider/presets')
      await get('/context')
    } finally { spy.mockRestore() }
    expect(timeouts).toEqual([30_000, 55_000, 10_000, 10_000])
  })

  it('allows only GET on packages', async () => {
    const calls = stubUpstream(() => json(200, {}))
    expect((await post('/packages/00000000-0000-4000-8000-000000000001')).status).toBe(404)
    expect((await post('/packages')).status).toBe(404)
    expect(calls).toHaveLength(0)
  })

  it('drops every upstream header, including set-cookie', async () => {
    stubUpstream(() => new Response('{"ok":true}', { status: 200, headers: { 'set-cookie': 'evil=1; Path=/', 'x-powered-by': 'upstream', 'content-type': 'application/json' } }))
    const result = await get('/context')
    expect(result.headers.get('set-cookie')).toBeNull()
    expect(result.headers.get('x-powered-by')).toBeNull()
  })

  it('always labels its bodies application/json, including errors and non-object JSON', async () => {
    stubUpstream(() => new Response('"plain"', { status: 200 }))
    const text = await get('/context')
    expect(text.headers.get('content-type')).toMatch(/^application\/json/)
    expect(text.body).toBe('plain')
    expect((await get('/context', {})).headers.get('content-type')).toMatch(/^application\/json/)
    stubUpstream(() => json(500))
    expect((await get('/context')).headers.get('content-type')).toMatch(/^application\/json/)
  })

  it('rejects methods outside GET, POST, PATCH and DELETE', async () => {
    expect((await send(proxy, '/api/vendor/v1/commercial/plans', { method: 'PUT', body: {}, headers: cookieHeader() })).status).toBe(405)
  })

  it('answers 503 for every call when the service key is short or the control URL is not secure', async () => {
    const calls = stubUpstream(() => json(200))
    for (const overrides of [{ serviceKey: 'short' }, { serviceKey: '' }, { controlUrl: '' }, { controlUrl: 'http://control.example.com' }, { controlUrl: 'https://u:p@control.example.com' }, { installationId: '' }]) {
      stubConfig(overrides)
      expect(await get('/context'), JSON.stringify(overrides)).toMatchObject({ status: 503, body: { code: 'vendor_unavailable' } })
    }
    expect(calls).toHaveLength(0)
  })

  it('keeps the raw session out of the response', async () => {
    stubUpstream(() => json(200, { ok: true }))
    expect((await get('/context')).text).not.toContain(SESSION)
  })
})
