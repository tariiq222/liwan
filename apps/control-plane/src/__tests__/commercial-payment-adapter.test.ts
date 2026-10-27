// Unit test (no DB, no network): payment adapter contracts with injected fetch.
import { describe, expect, it } from 'vitest'
import { PaymentError, paymentAdapterFromEnv, assertReturnUrl } from '../commercial/payment-adapter.js'
import { MoyasarAdapter, confirmEvent } from '../commercial/moyasar-adapter.js'
import { SimulatorAdapter } from '../commercial/payment-simulator.js'

const ORIGIN = 'https://app.webvue.test'
const enc = (o: unknown) => new TextEncoder().encode(JSON.stringify(o))
type Call = { url: string; init: any }
function mock(responses: any[]) {
  const calls: Call[] = []
  const fetchImpl = (async (url: string, init: any) => {
    calls.push({ url, init })
    const r = responses.shift() ?? {}
    return { ok: (r.http ?? 200) < 400, status: r.http ?? 200, text: async () => JSON.stringify(r.body ?? r) }
  }) as unknown as typeof fetch
  return { calls, fetchImpl }
}
const mk = (over: any = {}, responses: any[] = []) => {
  const m = mock(responses)
  const a = new MoyasarAdapter({
    secretKey: 'sk_test_abc', webhookSecret: 'whsec', merchantAccount: 'acme', expectLive: false,
    allowedReturnOrigins: [ORIGIN], fetchImpl: m.fetchImpl, ...over,
  })
  return { a, ...m }
}
const hook = (o: any = {}) => enc({
  id: 'evt_1', type: 'payment_paid', created_at: '2026-01-01T00:00:00Z', secret_token: 'whsec', account_name: 'acme', live: false,
  data: { id: 'pay_1', invoice_id: 'inv_1', status: 'paid', amount: 5000, currency: 'SAR', metadata: { attempt_id: 'att_1' } }, ...o,
})
const attempt = {
  attempt_id: 'att_1', order_id: 'ord_1', amount: { currency: 'SAR', exponent: 2, minor: 5000 }, description: 'Plan',
  success_url: `${ORIGIN}/ok`, back_url: `${ORIGIN}/back`, callback_url: `${ORIGIN}/hook`,
}
const code = async (p: Promise<unknown> | (() => unknown)) => {
  try { await (typeof p === 'function' ? p() : p) } catch (e) { return (e as PaymentError).code }
  return 'none'
}

describe('MoyasarAdapter', () => {
  it('createAttempt request shape', async () => {
    const { a, calls } = mk({}, [{ id: 'inv_1', status: 'initiated', url: 'https://pay/inv_1' }])
    const r = await a.createAttempt(attempt)
    expect(r).toEqual({ provider_ref: 'inv_1', redirect_url: 'https://pay/inv_1', status: 'pending' })
    const c = calls[0]
    expect(c.url).toBe('https://api.moyasar.com/v1/invoices')
    expect(c.init.method).toBe('POST')
    expect(c.init.headers.authorization).toBe('Basic ' + Buffer.from('sk_test_abc:').toString('base64'))
    const b = JSON.parse(c.init.body)
    expect(b).toMatchObject({ amount: 5000, currency: 'SAR', callback_url: `${ORIGIN}/hook`, success_url: `${ORIGIN}/ok`, back_url: `${ORIGIN}/back` })
    expect(b.metadata.attempt_id).toBe('att_1')
  })
  it('key/mode guards', () => {
    const base = { webhookSecret: 'w', merchantAccount: 'a', allowedReturnOrigins: [ORIGIN] }
    expect(() => new MoyasarAdapter({ ...base, secretKey: 'sk_live_x', expectLive: false })).toThrow(/key_mode_mismatch/)
    expect(() => new MoyasarAdapter({ ...base, secretKey: 'sk_test_x', expectLive: true })).toThrow(/key_mode_mismatch/)
    expect(new MoyasarAdapter({ ...base, secretKey: 'sk_live_x', expectLive: true }).mode).toBe('live')
  })
  it('error messages never leak keys', async () => {
    const { a } = mk({}, [{ http: 400, body: { message: 'bad sk_test_abc whsec' } }])
    try { await a.lookupAttempt('inv_1') } catch (e) { expect(String(e)).not.toContain('sk_test_abc') }
  })
  it('verifyEvent good / bad secret / merchant / mode', () => {
    const { a } = mk()
    const e = a.verifyEvent(hook(), {})
    expect(e).toMatchObject({ event_id: 'evt_1', provider_ref: 'inv_1', payment_id: 'pay_1', attempt_id: 'att_1', status: 'succeeded', merchant_account: 'acme', live: false })
    expect(e.amount).toEqual({ currency: 'SAR', exponent: 2, minor: 5000 })
    expect(() => a.verifyEvent(hook({ secret_token: 'nope' }), {})).toThrow(/signature_invalid/)
    expect(() => a.verifyEvent(hook({ secret_token: 'whsecX' }), {})).toThrow(/signature_invalid/)
    expect(() => a.verifyEvent(hook({ account_name: 'other' }), {})).toThrow(/merchant_mismatch/)
    expect(() => a.verifyEvent(hook({ live: true }), {})).toThrow(/mode_mismatch/)
    expect(() => a.verifyEvent(new TextEncoder().encode('{x'), {})).toThrow(/invalid_event/)
  })
  it('duplicate and out-of-order mapping is stable', () => {
    const { a } = mk()
    expect(a.verifyEvent(hook(), {})).toEqual(a.verifyEvent(hook(), {}))
    const late = a.verifyEvent(hook({ id: 'evt_0', type: 'payment_authorized', data: { id: 'pay_1', invoice_id: 'inv_1', amount: 5000, currency: 'SAR' } }), {})
    expect(late.status).toBe('pending')
    expect(a.verifyEvent(hook({ type: 'payment_refunded' }), {}).status).toBe('refunded')
    expect(a.verifyEvent(hook({ type: 'payment_abandoned' }), {}).status).toBe('canceled')
  })
  it('confirmEvent returns authoritative state and rejects mismatches', async () => {
    const inv = (o: any = {}) => ({ id: 'inv_1', status: 'paid', amount: 5000, currency: 'SAR', metadata: { attempt_id: 'att_1' }, payments: [{ id: 'pay_1', status: 'paid' }], ...o })
    const ok = mk({}, [inv()])
    const ev = ok.a.verifyEvent(hook(), {})
    expect((await confirmEvent(ok.a, ev)).status).toBe('succeeded')
    expect(ok.calls[0].url).toBe('https://api.moyasar.com/v1/invoices/inv_1')
    expect(await code(confirmEvent(mk({}, [inv({ amount: 100 })]).a, ev))).toBe('event_mismatch')
    expect(await code(confirmEvent(mk({}, [inv({ currency: 'USD' })]).a, ev))).toBe('event_mismatch')
    expect(await code(confirmEvent(mk({}, [inv({ id: 'inv_2' })]).a, ev))).toBe('event_mismatch')
  })
  it('confirms a token charge through the payment endpoint, never the invoice endpoint', async () => {
    const pay = { id: 'pay_9', status: 'paid', amount: 5000, currency: 'SAR' }
    const r = mk({}, [pay])
    const ev = r.a.verifyEvent(hook({ data: { id: 'pay_9', status: 'paid', amount: 5000, currency: 'SAR' } }), {})
    expect(ev.provider_ref).toBe('pay_9')
    expect((await confirmEvent(r.a, ev, { tokenCharge: true })).status).toBe('succeeded')
    expect(r.calls.map(c => c.url)).toEqual(['https://api.moyasar.com/v1/payments/pay_9'])
    expect(await code(confirmEvent(mk({}, [{ ...pay, amount: 1 }]).a, ev, { tokenCharge: true }))).toBe('event_mismatch')
    // Without the marker the same event is looked up as an invoice, which does not exist for a payment id.
    expect(await code(confirmEvent(mk({}, [{ http: 404 }]).a, ev))).toBe('not_found')
  })
  it('refund and chargeToken shapes', async () => {
    const r = mk({}, [{ id: 'pay_1', status: 'refunded', amount: 5000, refunded: 2000, currency: 'SAR' }])
    const out = await r.a.refund('pay_1', { currency: 'SAR', exponent: 2, minor: 2000 })
    expect(r.calls[0].url).toBe('https://api.moyasar.com/v1/payments/pay_1/refund')
    expect(JSON.parse(r.calls[0].init.body)).toEqual({ amount: 2000 })
    expect(out.refunded.minor).toBe(2000)
    const c = mk({}, [{ id: 'tok_1', status: 'active' }, { id: 'pay_2', status: 'paid', amount: 3000, currency: 'SAR' }])
    const ev = await c.a.chargeToken({ given_id: 'g-1', token: 'tok_1', amount: { currency: 'SAR', exponent: 2, minor: 3000 }, description: 'renew', callback_url: `${ORIGIN}/hook` })
    expect(c.calls[0].url).toContain('/tokens/tok_1')
    expect(c.calls[1].url).toBe('https://api.moyasar.com/v1/payments')
    expect(JSON.parse(c.calls[1].init.body)).toMatchObject({ given_id: 'g-1', amount: 3000, source: { type: 'token', token: 'tok_1' } })
    expect(ev.status).toBe('succeeded')
    const bad = mk({}, [{ id: 'tok_1', status: 'inactive' }])
    expect(await code(bad.a.chargeToken({ given_id: 'g', token: 'tok_1', amount: { currency: 'SAR', exponent: 2, minor: 3000 }, description: 'x', callback_url: `${ORIGIN}/h` }))).toBe('provider_error')
    expect(bad.calls).toHaveLength(1)
  })
  it('return url allowlist', async () => {
    expect(() => assertReturnUrl('http://evil.com/x', [ORIGIN])).toThrow(/return_url_forbidden/)
    expect(() => assertReturnUrl('https://evil.com/x', [ORIGIN])).toThrow(/return_url_forbidden/)
    expect(() => assertReturnUrl('http://localhost:3000/x', ['http://localhost:3000'])).not.toThrow()
    expect(() => assertReturnUrl('http://example.com/x', ['http://example.com'])).toThrow(/return_url_forbidden/)
    expect(() => assertReturnUrl('http://shop.test/x', ['http://shop.test'])).not.toThrow()
    const { a, calls } = mk()
    expect(await code(a.createAttempt({ ...attempt, success_url: 'https://evil.com/ok' }))).toBe('return_url_forbidden')
    expect(calls).toHaveLength(0)
  })
})

describe('paymentAdapterFromEnv', () => {
  it('requires config, never falls back', () => {
    expect(() => paymentAdapterFromEnv({})).toThrow(/provider_not_configured/)
    expect(() => paymentAdapterFromEnv({ WEBVUE_PAYMENT_PROVIDER: 'moyasar' })).toThrow(/provider_not_configured/)
    const full = { WEBVUE_PAYMENT_PROVIDER: 'moyasar', MOYASAR_SECRET_KEY: 'sk_test_a', MOYASAR_WEBHOOK_SECRET: 'w', MOYASAR_ACCOUNT_NAME: 'acme', MOYASAR_MODE: 'test', WEBVUE_PAYMENT_RETURN_ORIGINS: ORIGIN }
    expect(paymentAdapterFromEnv(full).mode).toBe('test')
    expect(() => paymentAdapterFromEnv({ ...full, MOYASAR_WEBHOOK_SECRET: undefined })).toThrow(/provider_not_configured/)
  })
  it('simulator never in production', () => {
    expect(paymentAdapterFromEnv({ WEBVUE_PAYMENT_PROVIDER: 'simulator' }).mode).toBe('simulator')
    expect(() => paymentAdapterFromEnv({ WEBVUE_PAYMENT_PROVIDER: 'simulator', NODE_ENV: 'production' })).toThrow(/provider_forbidden/)
    expect(() => new SimulatorAdapter({ env: {}, live: true })).toThrow(/provider_forbidden/)
  })
  it('simulator references stay unique across instances (process restarts)', async () => {
    const first = await new SimulatorAdapter({ env: {} }).createAttempt(attempt)
    const second = await new SimulatorAdapter({ env: {} }).createAttempt(attempt)
    expect(first.provider_ref).toMatch(/^sim_inv_[0-9a-f]{8}_1$/)
    expect(second.provider_ref).not.toBe(first.provider_ref)
  })
})

describe('SimulatorAdapter scenarios', () => {
  const sim = () => new SimulatorAdapter({ env: {} })
  it('succeed / fail / cancel', async () => {
    for (const [o, st] of [['succeed', 'succeeded'], ['fail', 'failed'], ['cancel', 'canceled']] as const) {
      const s = sim().script('att_1', o)
      const { provider_ref } = await s.createAttempt(attempt)
      expect((await s.lookupAttempt(provider_ref)).status).toBe('pending')
      const ev = s.verifyEvent(s.webhookBody(provider_ref), {})
      expect(ev.status).toBe(st); expect(ev.simulated).toBe(true)
      s.settle(provider_ref)
      expect((await confirmEvent(s, ev)).status).toBe(st)
    }
  })
  it('timeout records attempt', async () => {
    const s = sim().script('att_1', 'timeout')
    expect(await code(s.createAttempt(attempt))).toBe('timeout')
    expect((await s.lookupByAttemptId('att_1'))?.attempt_id).toBe('att_1')
  })
  it('duplicate and out-of-order', async () => {
    const s = sim(); const { provider_ref: r } = await s.createAttempt(attempt)
    const [a, b] = s.duplicateBodies(r)
    expect(s.verifyEvent(a, {}).event_id).toBe(s.verifyEvent(b, {}).event_id)
    const [first, late] = s.outOfOrderBodies(r)
    expect(s.verifyEvent(first, {}).status).toBe('succeeded')
    expect(s.verifyEvent(late, {}).status).toBe('pending')
  })
  it('wrong amount/currency/merchant/secret', async () => {
    const s = sim(); const { provider_ref: r } = await s.createAttempt(attempt)
    s.settle(r)
    const wrong = s.verifyEvent(s.webhookBody(r, { amount: { currency: 'USD', exponent: 2, minor: 1 } }), {})
    expect(await code(confirmEvent(s, wrong))).toBe('event_mismatch')
    expect(() => s.verifyEvent(s.webhookBody(r, { merchant: 'evil' }), {})).toThrow(/merchant_mismatch/)
    expect(() => s.verifyEvent(s.webhookBody(r, { secret: 'bad' }), {})).toThrow(/signature_invalid/)
    expect(() => s.verifyEvent(s.webhookBody(r, { live: true }), {})).toThrow(/mode_mismatch/)
  })
  it('refund and idempotent token charge', async () => {
    const s = sim().addToken('tok'); const { provider_ref: r } = await s.createAttempt(attempt)
    const ev = s.settle(r)
    expect((await s.refund(ev.payment_id!)).refunded.minor).toBe(5000)
    const args = { given_id: 'g1', token: 'tok', amount: attempt.amount, description: 'x', callback_url: `${ORIGIN}/h` }
    expect(await s.chargeToken(args)).toBe(await s.chargeToken(args))
  })
})
