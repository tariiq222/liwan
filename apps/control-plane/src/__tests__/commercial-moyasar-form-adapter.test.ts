// Unit test (no DB, no network): the Moyasar adapter's payment-intent, token, refund and webhook surface, with a stubbed fetch whose
// responses are shaped after docs/operations/moyasar-form-spike.md, and the simulator's parity with it.
import { describe, expect, it } from 'vitest'
import { MIN_REFUND_MINOR, PaymentError, paymentAdapterFromEnv } from '../commercial/payment-adapter.js'
import { MoyasarAdapter, USER_AGENT } from '../commercial/moyasar-adapter.js'
import { SimulatorAdapter } from '../commercial/payment-simulator.js'
import { buildAttemptDescription, parseAttemptDescription } from '../commercial/payment-description.js'

const ORIGIN = 'https://app.liwan.test'
const SECRET_KEY = 'sk_test_SECRETKEYVALUE123'
const PUBLISHABLE_KEY = 'pk_test_PUBLISHABLEVALUE456'
const TOKEN = 'token_Abc123Def456'
const ATTEMPT = '3f0c2b1e-5d4a-4c8b-9a7e-1b2c3d4e5f60'
const sar = (minor: number) => ({ currency: 'SAR', exponent: 2, minor })
const CALLBACK = `${ORIGIN}/api/commercial/payment-callback?attempt=${ATTEMPT}`

type Call = { url: string; init: any }
function mock(responses: any[]) {
  const calls: Call[] = []
  const fetchImpl = (async (url: string, init: any) => {
    calls.push({ url, init })
    const r = responses.shift() ?? {}
    if (r.throws) throw r.throws
    return { ok: (r.http ?? 200) < 400, status: r.http ?? 200, text: async () => JSON.stringify(r.body ?? r) }
  }) as unknown as typeof fetch
  return { calls, fetchImpl }
}
const mk = (responses: any[] = [], over: Record<string, unknown> = {}) => {
  const m = mock(responses)
  const a = new MoyasarAdapter({
    secretKey: SECRET_KEY, publishableKey: PUBLISHABLE_KEY, webhookSecret: 'whsec-whsec-whsec', merchantAccount: 'acme', expectLive: false,
    allowedReturnOrigins: [ORIGIN], fetchImpl: m.fetchImpl, ...over,
  })
  return { a, ...m }
}
const failure = async (p: Promise<unknown> | (() => unknown)): Promise<PaymentError> => {
  try { await (typeof p === 'function' ? p() : p) } catch (e) { return e as PaymentError }
  throw new Error('expected a failure')
}
const enc = (o: unknown) => new TextEncoder().encode(JSON.stringify(o))

const intentBody = (over: Record<string, unknown> = {}) => ({
  id: 'intent_1', status: 'created', amount: 11500, currency: 'SAR', description: buildAttemptDescription(ATTEMPT), callback_url: CALLBACK,
  client_secret: 'secret_for_the_browser', expires_at: '2026-11-13T20:00:00.000Z', created_at: '2026-11-13T19:00:00.000Z', ...over,
})
const paymentBody = (over: Record<string, unknown> = {}, source: Record<string, unknown> = {}) => ({
  id: 'pay_1', status: 'paid', amount: 11500, fee: 118, currency: 'SAR', refunded: 0, captured: 0, description: buildAttemptDescription(ATTEMPT), callback_url: CALLBACK,
  ip: null, metadata: null, created_at: '2026-11-13T19:00:00.000Z', updated_at: '2026-11-13T19:00:05.000Z',
  source: { type: 'creditcard', company: 'visa', name: 'Test Customer', number: '411111XXXXXX1111', gateway_id: 'g1', reference_number: 'r1', token: TOKEN, message: null, transaction_url: null, ...source },
  ...over,
})
const tokenBody = (over: Record<string, unknown> = {}) => ({
  id: TOKEN, status: 'active', brand: 'visa', funding: 'credit', country: 'US', month: '12', year: '2030', name: 'Test Customer', last_four: '1111', metadata: null, ...over,
})
const charge = { given_id: 'given-1', token: TOKEN, amount: sar(5000), description: 'renewal', callback_url: CALLBACK }

describe('the attempt description', () => {
  it('round-trips an attempt id and refuses anything the adapter did not build', () => {
    expect(parseAttemptDescription(buildAttemptDescription(ATTEMPT))).toBe(ATTEMPT)
    for (const tampered of [
      `${buildAttemptDescription(ATTEMPT)} `, ` ${buildAttemptDescription(ATTEMPT)}`, buildAttemptDescription(ATTEMPT).toUpperCase(), 'HACKED',
      `LiwanOS payment ${ATTEMPT}x`, `LiwanOS payment ${ATTEMPT.slice(1)}`, `LiwanOS payment ${ATTEMPT}\nHACKED`, `liwanos payment ${ATTEMPT}`, '', null, undefined, 42,
    ]) expect(parseAttemptDescription(tampered)).toBeNull()
  })
  it('refuses to build one from anything but a lowercase uuid', () => {
    for (const bad of ['', 'order-1', ATTEMPT.toUpperCase(), `${ATTEMPT} `]) expect(() => buildAttemptDescription(bad)).toThrow()
  })
})

describe('boot: the publishable key', () => {
  const env = (over: Record<string, string | undefined> = {}) => ({
    LIWAN_PAYMENT_PROVIDER: 'moyasar', MOYASAR_MODE: 'test', MOYASAR_SECRET_KEY: SECRET_KEY, MOYASAR_PUBLISHABLE_KEY: PUBLISHABLE_KEY,
    MOYASAR_WEBHOOK_SECRET: 'w'.repeat(32), MOYASAR_ACCOUNT_NAME: 'acme', LIWAN_PAYMENT_RETURN_ORIGINS: ORIGIN, ...over,
  })
  it('is exposed through the adapter and is not the secret key', () => {
    const adapter = paymentAdapterFromEnv(env())
    expect(adapter.publishableKey).toBe(PUBLISHABLE_KEY)
    expect(adapter.publishableKey).not.toBe(SECRET_KEY)
  })
  it('is optional: an adapter without it builds, has no key to expose, and refuses only card payments through the form', async () => {
    const adapter = paymentAdapterFromEnv(env({ MOYASAR_PUBLISHABLE_KEY: undefined }))
    expect(adapter.publishableKey).toBeNull()
    expect(paymentAdapterFromEnv({ LIWAN_PAYMENT_PROVIDER: 'simulator' }).provider).toBe('simulator')
    const { a, calls } = mk([{ id: 'pay_1', status: 'refunded', amount: 5000, refunded: 5000, currency: 'SAR' }], { publishableKey: undefined })
    expect(a.publishableKey).toBeNull()
    const error = await failure(a.createIntent({ attempt_id: ATTEMPT, amount: sar(11500), callback_url: CALLBACK }))
    expect(error.code).toBe('provider_not_configured')
    expect(error.message).toContain('MOYASAR_PUBLISHABLE_KEY')
    expect(calls).toHaveLength(0)
    expect((await a.refund('pay_1')).outcome).toBe('refunded')
  })
  it('opens webhook registration only for the exact value `open`', () => {
    for (const [value, open] of [['open', true], ['', false], ['true', false], ['OPEN', false], [undefined, false]] as const) {
      const adapter = paymentAdapterFromEnv(env({ MOYASAR_WEBHOOK_REGISTRATION: value }))
      const body = enc({ type: 'webhook_verification', account_name: 'acme', live: false, data: { webhook_id: 'wh_1', verification_code: '123456' } })
      if (open) expect(adapter.webhookVerification(body, {})).toMatchObject({ authenticated: false })
      else expect(() => adapter.webhookVerification(body, {})).toThrow(/signature_invalid/)
    }
  })
  it('refuses a key of the other mode, like the secret key check', () => {
    expect(() => paymentAdapterFromEnv(env({ MOYASAR_PUBLISHABLE_KEY: 'pk_live_x' }))).toThrow(/key_mode_mismatch/)
    expect(() => paymentAdapterFromEnv(env({ MOYASAR_MODE: 'live', MOYASAR_SECRET_KEY: 'sk_live_x' }))).toThrow(/key_mode_mismatch/)
    expect(() => paymentAdapterFromEnv(env({ MOYASAR_MODE: 'live', MOYASAR_SECRET_KEY: 'sk_live_x', MOYASAR_PUBLISHABLE_KEY: 'pk_live_x' }))).not.toThrow()
  })
  it('refuses a secret key in its place without printing it', () => {
    const error = (() => { try { paymentAdapterFromEnv(env({ MOYASAR_PUBLISHABLE_KEY: SECRET_KEY })) } catch (e) { return e as PaymentError } })()!
    expect(error.code).toBe('provider_not_configured')
    expect(error.message).not.toContain(SECRET_KEY)
  })
})

describe('MoyasarAdapter payment intents', () => {
  it('creates an intent with the secret key and server-set values only', async () => {
    const { a, calls } = mk([intentBody()])
    const intent = await a.createIntent({ attempt_id: ATTEMPT, amount: sar(11500), callback_url: CALLBACK })
    expect(intent).toEqual({ id: 'intent_1', client_secret: 'secret_for_the_browser', status: 'created', expires_at: '2026-11-13T20:00:00.000Z', amount: sar(11500), description: buildAttemptDescription(ATTEMPT), callback_url: CALLBACK })
    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe('https://api.moyasar.com/v1/payment_intents')
    expect(calls[0].init.method).toBe('POST')
    expect(JSON.parse(calls[0].init.body)).toEqual({ amount: 11500, currency: 'SAR', description: buildAttemptDescription(ATTEMPT), callback_url: CALLBACK })
    expect(calls[0].init.headers.authorization).toBe('Basic ' + Buffer.from(`${SECRET_KEY}:`).toString('base64'))
    expect(calls[0].init.headers['user-agent']).toBe(USER_AGENT)
    expect(calls[0].url + calls[0].init.body).not.toContain(SECRET_KEY)
    expect(calls[0].url + calls[0].init.body).not.toContain(PUBLISHABLE_KEY)
  })
  it('refuses a callback outside the allowlist and an amount below the minimum before any call', async () => {
    const { a, calls } = mk()
    expect((await failure(a.createIntent({ attempt_id: ATTEMPT, amount: sar(11500), callback_url: 'https://evil.example/cb' }))).code).toBe('return_url_forbidden')
    expect((await failure(a.createIntent({ attempt_id: ATTEMPT, amount: sar(99), callback_url: CALLBACK }))).code).toBe('invalid_amount')
    expect(calls).toHaveLength(0)
  })
  it('reads an intent again with the same client secret, and refuses a response without one', async () => {
    const again = mk([intentBody({ status: 'fulfilled' })])
    expect(await again.a.getIntent('intent_1')).toMatchObject({ id: 'intent_1', client_secret: 'secret_for_the_browser', status: 'fulfilled' })
    expect(again.calls[0].url).toBe('https://api.moyasar.com/v1/payment_intents/intent_1')
    expect(again.calls[0].init.method).toBe('GET')
    expect((await mk([intentBody({ status: 'something_new' })]).a.getIntent('i')).status).toBe('unrecognized')
    expect((await failure(mk([intentBody({ client_secret: undefined })]).a.getIntent('i'))).code).toBe('provider_error')
    expect((await failure(mk([intentBody({ expires_at: undefined })]).a.getIntent('i'))).code).toBe('provider_error')
  })
  it('cancels an intent, and says so when it was already consumed or cancelled', async () => {
    const ok = mk([intentBody({ status: 'canceled' })])
    expect(await ok.a.cancelIntent('intent_1')).toBe('canceled')
    expect(ok.calls[0].url).toBe('https://api.moyasar.com/v1/payment_intents/intent_1/cancel')
    expect(ok.calls[0].init.method).toBe('POST')
    expect(await mk([{ http: 400, body: { type: 'intent_not_cancelable', message: 'Intent is fulfilled and cannot be canceled.' } }]).a.cancelIntent('i')).toBe('not_cancelable')
    expect((await failure(mk([{ http: 500, body: { message: 'boom' } }]).a.cancelIntent('i'))).code).toBe('provider_error')
  })
})

describe('MoyasarAdapter reading a payment', () => {
  it('returns everything verification needs from a paid payment of an intent', async () => {
    const { a, calls } = mk([paymentBody({ metadata: { attempt_id: 'someone-elses' } })])
    const record = await a.readPayment('pay_1')
    expect(calls[0].url).toBe('https://api.moyasar.com/v1/payments/pay_1')
    expect(record).toEqual({
      payment_id: 'pay_1', status: 'succeeded', provider_status: 'paid', amount: sar(11500), refunded: null,
      description: buildAttemptDescription(ATTEMPT), attempt_id: ATTEMPT, callback_url: CALLBACK, live: false, invoice_id: null,
      token: TOKEN, authenticated: null, decline_message: null,
    })
  })
  it('names the attempt by the locked description alone, never by the browser-chosen metadata', async () => {
    const forged = await mk([paymentBody({ description: 'HACKED', metadata: { attempt_id: ATTEMPT } })]).a.readPayment('pay_1')
    expect(forged.attempt_id).toBeNull()
    expect(forged.description).toBe('HACKED')
    expect((await mk([paymentBody({ description: `${buildAttemptDescription(ATTEMPT)}!` })]).a.readPayment('pay_1')).attempt_id).toBeNull()
  })
  it('carries the decline message of a failed payment, the cumulative refund of a refunded one, and no token when none was saved', async () => {
    const failed = await mk([paymentBody({ status: 'failed' }, { token: null, message: 'INSUFFICIENT FUNDS' })]).a.readPayment('p')
    expect(failed).toMatchObject({ status: 'failed', decline_message: 'INSUFFICIENT FUNDS', token: null })
    const partial = await mk([paymentBody({ status: 'refunded', refunded: 300 })]).a.readPayment('p')
    expect(partial).toMatchObject({ status: 'refunded', refunded: sar(300), amount: sar(11500) })
    expect((await mk([paymentBody({}, { message: 'APPROVED' })]).a.readPayment('p')).decline_message).toBeNull()
  })
  it('does not know whether 3-D Secure was passed: the sandbox payment object has no such field', async () => {
    for (const body of [paymentBody(), paymentBody({ status: 'failed' }), paymentBody({}, { transaction_url: 'https://api.moyasar.com/v1/card_auth/1' })])
      expect((await mk([body]).a.readPayment('p')).authenticated).toBeNull()
  })
  it('keeps lookupPayment on the event shape settlement uses, with the attempt from the description', async () => {
    const event = await mk([paymentBody()]).a.lookupPayment('pay_1')
    expect(event).toMatchObject({ provider_ref: 'pay_1', payment_id: 'pay_1', attempt_id: ATTEMPT, status: 'succeeded', live: false, merchant_account: 'acme' })
  })
})

describe('MoyasarAdapter tokens', () => {
  it('reads the display facts and every status the sandbox showed', async () => {
    const { a, calls } = mk([tokenBody()])
    expect(await a.getToken(TOKEN)).toEqual({ id: TOKEN, status: 'active', active: true, brand: 'visa', last_four: '1111', exp_month: 12, exp_year: 2030, funding: 'credit' })
    expect(calls[0].url).toBe(`https://api.moyasar.com/v1/tokens/${TOKEN}`)
    for (const status of ['initiated', 'inactive', 'save_only'] as const) {
      const token = await mk([tokenBody({ status })]).a.getToken(TOKEN)
      expect(token).toMatchObject({ status, active: false })
    }
    expect(await mk([tokenBody({ status: 'brand_new_state' })]).a.getToken(TOKEN)).toMatchObject({ status: 'unrecognized', active: false })
    expect(await mk([tokenBody({ month: undefined, year: undefined, brand: undefined, last_four: 'x' })]).a.getToken(TOKEN)).toMatchObject({ exp_month: null, exp_year: null, brand: null, last_four: null })
  })
  it('deletes a token, and a token that is already gone is success', async () => {
    const ok = mk([{}])
    await ok.a.deleteToken(TOKEN)
    expect(ok.calls[0].init.method).toBe('DELETE')
    await mk([{ http: 404, body: { type: 'record_not_found', message: 'not found' } }]).a.deleteToken(TOKEN)
    expect((await failure(mk([{ http: 500, body: { message: 'boom' } }]).a.deleteToken(TOKEN))).code).toBe('provider_error')
  })
  it('never lets a token appear in an error message', async () => {
    const missing = await failure(mk([{ http: 404, body: { type: 'record_not_found', message: `no ${TOKEN}` } }]).a.getToken(TOKEN))
    expect(missing.code).toBe('not_found')
    expect(String(missing.message)).not.toContain(TOKEN)
    const echoed = await failure(mk([{ http: 500, body: { message: `failed for ${TOKEN} and ${SECRET_KEY}` } }]).a.getToken(TOKEN))
    expect(echoed.message).not.toContain(TOKEN)
    expect(echoed.message).not.toContain(SECRET_KEY)
    const unreachable = await failure(mk([{ throws: new Error(`connect failed ${TOKEN}`) }]).a.deleteToken(TOKEN))
    expect(unreachable.code).toBe('provider_unreachable')
    expect(unreachable.message).not.toContain(TOKEN)
    const other = await failure(mk([{ http: 400, body: { type: 'invalid_request_error', message: 'The token token_Zzz999 is invalid.' } }]).a.getToken(TOKEN))
    expect(other.message).not.toContain('token_Zzz999')
  })
})

describe('MoyasarAdapter charging a saved token', () => {
  it('pays at once with the caller given_id, no pre-read and no forced authentication', async () => {
    const { a, calls } = mk([paymentBody({ amount: 5000 }, { token: null })])
    const outcome = await a.chargeToken(charge)
    expect(outcome).toMatchObject({ outcome: 'paid', payment: { payment_id: 'pay_1', status: 'succeeded', token: null, amount: sar(5000) } })
    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe('https://api.moyasar.com/v1/payments')
    expect(JSON.parse(calls[0].init.body)).toEqual({ amount: 5000, currency: 'SAR', callback_url: CALLBACK, given_id: 'given-1', description: 'renewal', source: { type: 'token', token: TOKEN } })
    expect(calls[0].init.headers['user-agent']).toBe(USER_AGENT)
  })
  it('reports a decline with its message', async () => {
    const outcome = await mk([paymentBody({ status: 'failed' }, { token: null, message: 'DECLINED: EXPIRED CARD' })]).a.chargeToken(charge)
    expect(outcome).toMatchObject({ outcome: 'declined', message: 'DECLINED: EXPIRED CARD', payment: { status: 'failed' } })
  })
  it('treats an initiated payment (a save_only token) as the customer`s to act on, never as pending, and does not surface its URL', async () => {
    const url = 'https://api.moyasar.com/v1/card_auth/abc/form'
    const outcome = await mk([paymentBody({ status: 'initiated' }, { token: null, transaction_url: url })]).a.chargeToken(charge)
    expect(outcome.outcome).toBe('needs_customer_action')
    expect(JSON.stringify(outcome)).not.toContain(url)
  })
  it('answers token_unusable for the one 400 an invalid, inactive, deleted or unknown token gets, and keeps the token out of anything thrown', async () => {
    const bad = { http: 400, body: { type: 'invalid_request_error', message: `The token ${TOKEN} is invalid.` } }
    expect(await mk([bad]).a.chargeToken(charge)).toEqual({ outcome: 'token_unusable' })
    // Another 400 is the caller's mistake, not a token verdict.
    const given = await failure(mk([{ http: 400, body: { type: 'used_given_id', message: `given_id ${charge.given_id} taken for ${TOKEN}` } }]).a.chargeToken(charge))
    expect(given.code).toBe('used_given_id')
    expect(given.message).not.toContain(TOKEN)
    expect((await failure(mk([{ http: 400, body: { type: 'validation_error', message: 'bad', errors: { given_id: ['x'] } } }]).a.chargeToken(charge))).code).toBe('validation_error')
  })
  it('answers unknown when the charge may or may not have happened', async () => {
    const abort = Object.assign(new Error('aborted'), { name: 'AbortError' })
    expect(await mk([{ throws: abort }]).a.chargeToken(charge)).toEqual({ outcome: 'unknown', reason: 'timeout' })
    expect(await mk([{ throws: new Error('ECONNRESET') }]).a.chargeToken(charge)).toEqual({ outcome: 'unknown', reason: 'provider_unreachable' })
    expect(await mk([{ http: 502, body: { message: 'bad gateway' } }]).a.chargeToken(charge)).toEqual({ outcome: 'unknown', reason: 'provider_server_error' })
  })
  it('refuses a callback outside the allowlist before any call', async () => {
    const { a, calls } = mk()
    expect((await failure(a.chargeToken({ ...charge, callback_url: 'https://evil.example/x' }))).code).toBe('return_url_forbidden')
    expect(calls).toHaveLength(0)
  })
})

describe('MoyasarAdapter refunds', () => {
  const ref = { id: 'pay_1', status: 'refunded', amount: 5000, refunded: 5000, currency: 'SAR' }
    it('succeeds with the cumulative figure, whole when no amount is given', async () => {
    const whole = mk([ref])
    expect(await whole.a.refund('pay_1')).toMatchObject({ outcome: 'refunded', payment_id: 'pay_1', status: 'refunded', refunded: sar(5000) })
    expect(JSON.parse(whole.calls[0].init.body)).toEqual({})
    expect(await mk([{ ...ref, refunded: 300 }]).a.refund('pay_1', sar(300))).toMatchObject({ outcome: 'refunded', refunded: sar(300) })
  })
  it('answers already_refunded only for HTTP 400 with the provider`s words, and any other refusal stays a thrown error with its type', async () => {
    const already = { http: 400, body: { type: 'invalid_request', message: 'Payment is already refunded.' } }
    expect(await mk([already]).a.refund('pay_1', sar(300))).toEqual({ outcome: 'already_refunded' })
    const other = await failure(mk([{ http: 400, body: { type: 'invalid_request', message: 'Only paid or captured payments can be refunded.' } }]).a.refund('pay_1'))
    expect(other.code).toBe('invalid_request')
    const wrongStatus = await failure(mk([{ http: 409, body: { type: 'invalid_request', message: 'Payment is already refunded.' } }]).a.refund('pay_1'))
    expect(wrongStatus.code).toBe('invalid_request')
    const wrongType = await failure(mk([{ http: 400, body: { type: 'validation_error', message: 'Payment is already refunded.' } }]).a.refund('pay_1'))
    expect(wrongType.code).toBe('validation_error')
    // A refusal that merely mentions the amount is not the minimum.
    const amount = await failure(mk([{ http: 400, body: { type: 'validation_error', message: 'amount exceeds the payment', errors: { amount: ['too big'] } } }]).a.refund('pay_1', sar(300)))
    expect(amount.code).toBe('validation_error')
  })
  it('decides the minimum itself, before any call', async () => {
    expect(MIN_REFUND_MINOR).toBe(100)
    const { a, calls } = mk([ref])
    expect(await a.refund('pay_1', sar(MIN_REFUND_MINOR - 1))).toEqual({ outcome: 'below_minimum' })
    expect(calls).toHaveLength(0)
    expect((await a.refund('pay_1', sar(MIN_REFUND_MINOR))).outcome).toBe('refunded')
    expect(calls).toHaveLength(1)
  })
})

describe('MoyasarAdapter webhooks', () => {
  const hook = (over: Record<string, unknown> = {}, data: Record<string, unknown> = {}) => enc({
    id: 'evt_1', type: 'payment_paid', created_at: '2026-11-13T19:00:00Z', secret_token: 'whsec-whsec-whsec', account_name: 'acme', live: false,
    data: { id: 'pay_1', status: 'paid', amount: 11500, currency: 'SAR', description: buildAttemptDescription(ATTEMPT), metadata: { attempt_id: 'someone-elses' }, ...data }, ...over,
  })
  it('accepts both spellings of the failure event', () => {
    const { a } = mk()
    expect(a.verifyEvent(hook({ type: 'payment_failed' }), {}).status).toBe('failed')
    expect(a.verifyEvent(hook({ type: 'payment_faild' }), {}).status).toBe('failed')
  })
  it('names the attempt of a direct payment by its description, not by metadata', () => {
    const { a } = mk()
    const event = a.verifyEvent(hook(), {})
    expect(event).toMatchObject({ provider_ref: 'pay_1', attempt_id: ATTEMPT })
    expect(a.verifyEvent(hook({}, { description: 'HACKED' }), {}).attempt_id).toBeNull()
    // A hosted invoice payment still carries the server-set metadata of its invoice.
    expect(a.verifyEvent(hook({}, { description: 'Plan', invoice_id: 'inv_1', metadata: { attempt_id: 'att_9' } }), {}).attempt_id).toBe('att_9')
  })
  const verification = (over: Record<string, unknown> = {}, data: Record<string, unknown> = {}) => enc({
    id: 'evt_v', type: 'webhook_verification', created_at: '2026-11-13T19:00:00Z', secret_token: 'whsec-whsec-whsec', account_name: 'acme', live: false,
    data: { webhook_id: 'wh_1', verification_code: '123456', ...data }, ...over,
  })
  it('reads the registration event and is not a payment event', () => {
    const { a } = mk()
    expect(a.webhookVerification(verification(), {})).toEqual({ webhook_id: 'wh_1', code: '123456', authenticated: true, occurred_at: '2026-11-13T19:00:00Z' })
    expect(a.webhookVerification(hook(), {})).toBeNull()
    expect(a.webhookVerification(new TextEncoder().encode('{x'), {})).toBeNull()
    expect(() => a.verifyEvent(verification(), {})).toThrow(/invalid_event/)
  })
  it('requires the shared secret when the event carries one, and marks an event without one as unauthenticated', () => {
    const { a } = mk()
    expect(() => a.webhookVerification(verification({ secret_token: 'wrong' }), {})).toThrow(/signature_invalid/)
    expect(() => a.webhookVerification(verification({ account_name: 'other' }), {})).toThrow(/merchant_mismatch/)
    expect(() => a.webhookVerification(verification({ live: true }), {})).toThrow(/mode_mismatch/)
    // Without the secret, registration must have been opened by the operator.
    expect(() => a.webhookVerification(verification({ secret_token: undefined }), {})).toThrow(/signature_invalid/)
    const open = mk([], { webhookRegistrationOpen: true }).a
    expect(open.webhookVerification(verification({ secret_token: undefined }), {})).toMatchObject({ authenticated: false, code: '123456' })
    expect(() => open.webhookVerification(verification({ secret_token: undefined, account_name: 'other' }), {})).toThrow(/merchant_mismatch/)
    expect(() => open.webhookVerification(verification({ secret_token: undefined, live: true }), {})).toThrow(/mode_mismatch/)
    // A signed event ignores the setting: right secret accepted closed, wrong secret refused open.
    expect(a.webhookVerification(verification(), {})).toMatchObject({ authenticated: true })
    expect(() => open.webhookVerification(verification({ secret_token: 'wrong' }), {})).toThrow(/signature_invalid/)
    for (const code of ['12345', '1234567', 'abcdef', '']) expect(() => a.webhookVerification(verification({}, { verification_code: code }), {})).toThrow(/invalid_event/)
    expect(() => a.webhookVerification(verification({}, { webhook_id: '' }), {})).toThrow(/invalid_event/)
  })
})

describe('MoyasarAdapter HTTP errors and redaction', () => {
  it('uses the provider`s error type as the code, and provider_error for one it does not know', async () => {
    for (const type of ['used_given_id', 'intent_not_fulfillable', 'intent_not_cancelable', 'invalid_client_secret', 'validation_error', 'invalid_request', 'invalid_request_error'] as const) {
      const error = await failure(mk([{ http: 400, body: { type, message: 'nope' } }]).a.getIntent('i'))
      expect(error.code).toBe(type)
      expect(error.httpStatus).toBe(400)
    }
    const unknown = await failure(mk([{ http: 400, body: { type: 'mystery', message: 'x' } }]).a.getIntent('i'))
    expect(unknown.code).toBe('provider_error')
    expect(unknown.message).toContain('mystery')
    expect((await failure(mk([{ http: 404, body: { type: 'record_not_found' } }]).a.getIntent('i'))).code).toBe('not_found')
  })
  it('sends the same explicit user agent on every call and never puts a key in a url or a body', async () => {
    const { a, calls } = mk([intentBody(), paymentBody(), tokenBody(), {}])
    await a.getIntent('i'); await a.readPayment('p'); await a.getToken(TOKEN); await a.cancelAttempt('inv')
    expect(calls.map(c => c.init.headers['user-agent'])).toEqual([USER_AGENT, USER_AGENT, USER_AGENT, USER_AGENT])
    expect(USER_AGENT).not.toMatch(/python|urllib|liwan/i)
    for (const call of calls) expect(JSON.stringify([call.url, call.init.body])).not.toMatch(/sk_|pk_/)
  })
  it('keeps the secret key, the webhook secret and a client secret out of anything thrown', async () => {
    const echoed = await failure(mk([{ http: 400, body: { type: 'invalid_client_secret', message: `bad ${SECRET_KEY} whsec-whsec-whsec sk_live_OTHERKEY` } }]).a.getIntent('i'))
    for (const leaked of [SECRET_KEY, 'whsec-whsec-whsec', 'sk_live_OTHERKEY']) expect(echoed.message).not.toContain(leaked)
    const network = await failure(mk([{ throws: new Error(`getaddrinfo with ${SECRET_KEY}`) }]).a.getIntent('i'))
    expect(network.message).not.toContain(SECRET_KEY)
  })
})

describe('the simulator keeps the same payment surface', () => {
  const sim = () => new SimulatorAdapter()
  it('creates, reads and cancels an intent, and exposes a publishable key that is not a secret key', async () => {
    const s = sim()
    expect(s.publishableKey).toMatch(/^pk_/)
    const intent = await s.createIntent({ attempt_id: ATTEMPT, amount: sar(11500), callback_url: CALLBACK })
    expect(intent).toMatchObject({ status: 'created', amount: sar(11500), description: buildAttemptDescription(ATTEMPT), callback_url: CALLBACK })
    expect(intent.client_secret).toBeTruthy()
    expect(await s.getIntent(intent.id)).toEqual(intent)
    expect(await s.cancelIntent(intent.id)).toBe('canceled')
    expect(await s.cancelIntent(intent.id)).toBe('not_cancelable')
    expect((await s.getIntent(intent.id)).status).toBe('canceled')
  })
  it('fulfils an intent like the provider: locked values, a saved card, consumption, a wrong secret', async () => {
    const s = sim()
    const intent = await s.createIntent({ attempt_id: ATTEMPT, amount: sar(11500), callback_url: CALLBACK })
    expect((await failure(async () => s.fulfilIntent(intent.id, { clientSecret: 'wrong' }))).code).toBe('invalid_client_secret')
    const payment = s.fulfilIntent(intent.id, { clientSecret: intent.client_secret, saveCard: true })
    expect(payment).toMatchObject({ status: 'succeeded', amount: sar(11500), description: intent.description, callback_url: CALLBACK, attempt_id: ATTEMPT, authenticated: null })
    expect(payment.token).toBeTruthy()
    expect(await s.getToken(payment.token!)).toMatchObject({ status: 'active', active: true, brand: 'visa', last_four: '4242' })
    expect(await s.readPayment(payment.payment_id)).toEqual(payment)
    expect((await s.lookupPayment(payment.payment_id))).toMatchObject({ payment_id: payment.payment_id, attempt_id: ATTEMPT, status: 'succeeded' })
    expect((await failure(async () => s.fulfilIntent(intent.id, { clientSecret: intent.client_secret }))).code).toBe('intent_not_fulfillable')
  })
  it('lets a decline consume the intent and turn its token inactive', async () => {
    const s = sim()
    const intent = await s.createIntent({ attempt_id: ATTEMPT, amount: sar(11500), callback_url: CALLBACK })
    const payment = s.fulfilIntent(intent.id, { clientSecret: intent.client_secret, saveCard: true, card: { outcome: 'declined', message: 'INSUFFICIENT FUNDS' } })
    expect(payment).toMatchObject({ status: 'failed', decline_message: 'INSUFFICIENT FUNDS' })
    expect((await s.getToken(payment.token!)).status).toBe('inactive')
    expect((await s.getIntent(intent.id)).status).toBe('fulfilled')
  })
  it('refunds a direct payment once, from the minimum, and refuses the second', async () => {
    const s = sim()
    const intent = await s.createIntent({ attempt_id: ATTEMPT, amount: sar(11500), callback_url: CALLBACK })
    const payment = s.fulfilIntent(intent.id, { clientSecret: intent.client_secret })
    expect(await s.refund(payment.payment_id, sar(MIN_REFUND_MINOR - 1))).toEqual({ outcome: 'below_minimum' })
    expect(await s.refund(payment.payment_id, sar(300))).toMatchObject({ outcome: 'refunded', status: 'refunded', refunded: sar(300) })
    expect((await s.readPayment(payment.payment_id))).toMatchObject({ status: 'refunded', refunded: sar(300) })
    expect(await s.refund(payment.payment_id, sar(300))).toEqual({ outcome: 'already_refunded' })
    expect(await s.refund(payment.payment_id)).toEqual({ outcome: 'already_refunded' })
  })
  it('charges a saved token to the same outcomes', async () => {
    const s = sim().addToken('t-ok').addToken('t-off', 'inactive').addToken('t-save', 'save_only').addToken('t-decline').addToken('t-lost').addToken('t-act')
    s.scriptTokenCharge('t-decline', { outcome: 'declined', message: 'DECLINED' }).scriptTokenCharge('t-lost', { outcome: 'unknown' }).scriptTokenCharge('t-act', { outcome: 'needs_customer_action' })
    const input = (token: string, given_id: string) => ({ ...charge, token, given_id })
    expect(await s.chargeToken(input('t-ok', 'g1'))).toMatchObject({ outcome: 'paid', payment: { status: 'succeeded', token: null } })
    expect(await s.chargeToken(input('t-ok', 'g1'))).toBe(await s.chargeToken(input('t-ok', 'g1')))
    expect((await failure(s.chargeToken({ ...input('t-ok', 'g1'), amount: sar(1) }))).code).toBe('used_given_id')
    expect(await s.chargeToken(input('t-decline', 'g2'))).toMatchObject({ outcome: 'declined', message: 'DECLINED' })
    expect((await s.chargeToken(input('t-save', 'g3'))).outcome).toBe('needs_customer_action')
    expect((await s.chargeToken(input('t-act', 'g4'))).outcome).toBe('needs_customer_action')
    expect(await s.chargeToken(input('t-off', 'g5'))).toEqual({ outcome: 'token_unusable' })
    expect(await s.chargeToken(input('t-missing', 'g6'))).toEqual({ outcome: 'token_unusable' })
    expect(await s.chargeToken(input('t-lost', 'g7'))).toEqual({ outcome: 'unknown', reason: 'timeout' })
  })
  it('deletes a token idempotently', async () => {
    const s = sim().addToken('t')
    await s.deleteToken('t')
    await s.deleteToken('t')
    expect((await failure(s.getToken('t'))).code).toBe('not_found')
  })
  it('builds provider-shaped webhooks: a direct payment and the registration event', async () => {
    const s = sim()
    const intent = await s.createIntent({ attempt_id: ATTEMPT, amount: sar(11500), callback_url: CALLBACK })
    const payment = s.fulfilIntent(intent.id, { clientSecret: intent.client_secret })
    expect(s.verifyEvent(s.paymentWebhookBody(payment.payment_id), {})).toMatchObject({ provider_ref: payment.payment_id, attempt_id: ATTEMPT, status: 'succeeded' })
    expect(s.webhookVerification(s.verificationWebhookBody('wh_1', '123456'), {})).toMatchObject({ webhook_id: 'wh_1', code: '123456', authenticated: true })
    expect(() => s.webhookVerification(s.verificationWebhookBody('wh_1', '123456', { secret: null }), {})).toThrow(/signature_invalid/)
    expect(new SimulatorAdapter({ webhookRegistrationOpen: true }).webhookVerification(s.verificationWebhookBody('wh_1', '123456', { secret: null }), {})?.authenticated).toBe(false)
    expect(() => s.webhookVerification(s.verificationWebhookBody('wh_1', '123456', { secret: 'bad' }), {})).toThrow(/signature_invalid/)
    expect(s.webhookVerification(s.paymentWebhookBody(payment.payment_id), {})).toBeNull()
  })
})
