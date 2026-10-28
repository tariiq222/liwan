import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const forward = vi.hoisted(() => vi.fn())
const h3 = vi.hoisted(() => ({ sendWebResponse: vi.fn(), sendRedirect: vi.fn(), deleteCookie: vi.fn(), setResponseHeader: vi.fn() }))
vi.mock('../publicApi', () => ({ forwardPublicApi: forward }))
vi.mock('../tenantTransport', () => ({
  boundedTenantBody: async (event: { body?: Buffer }) => event.body,
  withTenantBody: async (_event: unknown, scope: unknown, run: () => unknown) => { expect(scope).toBe('public'); return run() },
  withTenantResponse: async (_event: unknown, _scope: unknown, run: () => unknown) => run(),
}))
vi.mock('h3', async importOriginal => ({ ...await importOriginal<typeof import('h3')>(), ...h3 }))

beforeEach(() => {
  forward.mockReset().mockResolvedValue(new Response('', { status: 200 }))
  for (const fn of Object.values(h3)) fn.mockClear()
  vi.stubGlobal('defineEventHandler', (handler: unknown) => handler)
  vi.stubGlobal('useRuntimeConfig', () => ({ odooUrl: 'http://guard:8080' }))
})
afterEach(() => vi.unstubAllGlobals())

async function relay(code: string, kind: string, { method = 'POST', query = '', cookie, body }: { method?: string; query?: string; cookie?: string; body?: Buffer } = {}) {
  const { default: handler } = await import('../../routes/payment/[code]/[kind]')
  const event = { path: `/payment/${code}/${kind}${query}`, method, body, context: { params: { code, kind } }, node: { req: { headers: cookie ? { cookie } : {} }, res: {} } }
  return { event, result: await (handler as (event: unknown) => Promise<unknown>)(event) }
}

describe('gateway callback relay', () => {
  it('relays a webhook unchanged to the Odoo dispatch route and answers what Odoo answers', async () => {
    const body = Buffer.from('{"obj":{}}')
    const { event } = await relay('paymob', 'webhook', { query: '?hmac=abc', body })
    expect(forward).toHaveBeenCalledExactlyOnceWith(event, 'http://guard:8080', '/api/v1/public/payments/hooks/paymob/webhook?hmac=abc', { method: 'POST', body })
    expect(h3.sendWebResponse).toHaveBeenCalledTimes(1)
    expect(h3.sendRedirect).not.toHaveBeenCalled()
  })

  it('sends a returning payer to the status page of the invoice they were paying', async () => {
    forward.mockResolvedValue(new Response(null, { status: 204 }))
    await relay('paymob', 'return', { method: 'GET', query: '?success=true', cookie: 'webvue_pay_return=7.tok_en-1' })
    expect(h3.sendRedirect).toHaveBeenCalledWith(expect.anything(), '/pay/invoice/7/status?access_token=tok_en-1', 303)
    expect(h3.deleteCookie).toHaveBeenCalledWith(expect.anything(), 'webvue_pay_return', { path: '/payment' })
  })

  it('sends a payer without a valid return cookie to the generic page', async () => {
    forward.mockResolvedValue(new Response(null, { status: 204 }))
    for (const cookie of [undefined, 'webvue_pay_return=7', 'webvue_pay_return=7.tok%3Bevil']) {
      h3.sendRedirect.mockClear()
      await relay('paymob', 'return', { method: 'GET', cookie })
      expect(h3.sendRedirect).toHaveBeenCalledWith(expect.anything(), '/pay/returned', 303)
    }
  })

  it('passes a refused return through instead of redirecting', async () => {
    forward.mockResolvedValue(new Response('', { status: 403 }))
    await relay('paymob', 'return', { method: 'GET', cookie: 'webvue_pay_return=7.tok' })
    expect(h3.sendWebResponse).toHaveBeenCalledTimes(1)
    expect(h3.sendRedirect).not.toHaveBeenCalled()
  })

  it('refuses unknown kinds, malformed codes and wrong methods before reaching Odoo', async () => {
    await expect(relay('paymob', 'refund')).rejects.toMatchObject({ statusCode: 404 })
    await expect(relay('Pay-Mob', 'webhook')).rejects.toMatchObject({ statusCode: 404 })
    await expect(relay('paymob', 'webhook', { method: 'GET' })).rejects.toMatchObject({ statusCode: 405 })
    expect(forward).not.toHaveBeenCalled()
  })
})
