// Card form payments on live PostgreSQL, against the payment simulator: no provider call, no key. Every settlement here comes from a payment
// fetched back from the (simulated) provider; the browser's hint and the webhook body only name a payment to fetch.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { Pool } from 'pg'
import { paymentAttemptRequestSchema, type FormPaymentSession, type PaymentAttemptRequest } from '@liwan/commercial-contracts'
import { client, money, monthly, seedPaymentMethod, setup, url } from './commercial-helpers.js'
import { acceptQuote } from '../commercial/orders.js'
import { createQuoteForCustomer } from '../commercial/quotes.js'
import { SimulatorAdapter } from '../commercial/payment-simulator.js'
import { buildAttemptDescription } from '../commercial/payment-description.js'
import { createPaymentAttempt, handleProviderEvent, reconcileUnknownAttempts, verifyReturnedAttempt } from '../commercial/payments.js'
import { processTokenDeletions } from '../commercial/form-payments.js'
import { processRefundOutbox } from '../commercial/settlements.js'
import { fixedReturnOrigin } from '../commercial/return-origin.js'

if (url && new URL(url).pathname !== '/liwan_control_scratch_payfinal') throw new Error('payment tests require own scratch DB')
const suite = url ? describe : describe.skip
const vendor: any = { actor_id: '7', kind: 'vendor', customer_id: null, tenant_id: null, capabilities: ['vendor.subscriptions.manage'] }
const sar = (minor: number) => ({ currency: 'SAR', exponent: 2, minor })

suite('card form payments on PostgreSQL', () => {
  const pool = new Pool({ connectionString: url, max: 8 }), api = client(pool)
  const plans: { allowed?: any; forbidden?: any } = {}
  beforeAll(async () => {
    const { version } = await setup(pool)
    await api('POST', '/catalog/releases', { catalog_version: version, reason: 'Form payment acceptance' })
    const make = async (autoRenew: boolean) => {
      const c = await api('POST', '/plans', { name: `Form ${autoRenew} ${randomUUID()}`, audience: { kind: 'public' }, term_months: 12, currency: 'SAR', prices: [{ cadence: monthly, amount: money(10000) }], platform_limits: {}, included_bundle_revision_ids: [], optional_bundle_revision_ids: [], included_extra_branches: 1, extra_branch_prices: [{ cadence: monthly, amount: money(5000) }], extra_branches_limit: null, included_users: 1, included_storage_mb: 0, storage_step_mb: 10240, storage_step_threshold_mb: 102400, storage_large_step_mb: 102400, user_prices: [{ cadence: monthly, amount: money(0) }], storage_prices: [{ cadence: monthly, amount: money(0) }], policy_revision_id: '6f1c3d8e-0000-4000-8000-000000000001', trial_days: 0, grace_days: 2, auto_suspend: true, auto_renew_allowed: autoRenew })
      const v = await api('POST', `/plans/${c.body.id}/validate`, { edit_revision: 1, reason: 'Form payment acceptance' })
      return (await api('POST', `/plans/${c.body.id}/publish`, { edit_revision: v.body.edit_revision, reason: 'Form payment acceptance' })).body
    }
    plans.allowed = await make(true)
    plans.forbidden = await make(false)
  })
  beforeEach(async () => { vi.restoreAllMocks(); await pool.query('TRUNCATE customers CASCADE'); await pool.query('TRUNCATE commercial_outbox') })
  afterAll(async () => { await pool.end() })

  /** A customer with one awaiting order and its issued invoice, and the simulator that pays it. */
  async function order(autoRenew = true, shared?: SimulatorAdapter) {
    const customer = randomUUID(), tenant = randomUUID()
    await pool.query("INSERT INTO tenants(id,name,commercial_mode,hosting_model,inventory_target,operations_enabled) VALUES($1,'Customer','saas','dedicated_managed',$2,true)", [tenant, `c-${tenant}`])
    await pool.query('INSERT INTO customers(id,name,tenant_id,admin_name,admin_login) VALUES($1,$2,$3,$4,$5)', [customer, 'Form customer', tenant, 'Manager', `${customer}@example.test`])
    const plan = autoRenew ? plans.allowed : plans.forbidden
    const quote = await createQuoteForCustomer(pool, { customer_id: customer, request: { kind: 'new', plan_revision_id: plan.id, bundle_revision_ids: [], cadence: monthly, requested_extra_branches: 0, requested_users: 1, requested_storage_mb: 0 } })
    await acceptQuote(pool, { quote_id: quote.id, expected_subscription_revision: 0, idempotency_key: randomUUID() }, vendor)
    const row = (await pool.query('SELECT id,subscription_id FROM orders WHERE customer_id=$1', [customer])).rows[0]
    const invoice = (await pool.query('SELECT id FROM invoices WHERE order_id=$1', [row.id])).rows[0].id
    const adapter = shared ?? new SimulatorAdapter({ env: { NODE_ENV: 'test' } })
    return { customer, order_id: row.id as string, subscription: row.subscription_id as string, invoice: invoice as string, adapter,
      input: { order_id: row.id as string, customer_id: customer, adapter, returnOrigin: fixedReturnOrigin('https://liwan.test') } }
  }
  type F = Awaited<ReturnType<typeof order>>
  const form = (f: F, over: Partial<PaymentAttemptRequest> = {}): Promise<FormPaymentSession> =>
    createPaymentAttempt(pool, { ...f.input, request: paymentAttemptRequestSchema.parse({ method: 'form', ...over }) as PaymentAttemptRequest & { method: 'form' } })
  const saving = { save_card: true, consent_text_version: 'v1' }
  const fulfil = (f: F, s: FormPaymentSession, o: Parameters<SimulatorAdapter['fulfilIntent']>[1] extends infer T ? Partial<T> : never = {}) =>
    f.adapter.fulfilIntent(s.intent.id, { clientSecret: s.intent.client_secret, ...o })
  const hint = async (f: F, attemptId: string, paymentId: string) => {
    await pool.query("UPDATE payment_attempts SET updated_at=now()-interval '10 seconds' WHERE id=$1", [attemptId])
    return verifyReturnedAttempt(pool, { attempt_id: attemptId, customer_id: f.customer, adapter: f.adapter, payment_hint: paymentId })
  }
  const webhook = (f: F, paymentId: string) => handleProviderEvent(pool, { provider: 'simulator', adapter: f.adapter, rawBody: f.adapter.paymentWebhookBody(paymentId), headers: {} })
  const attemptRow = async (id: string) => (await pool.query('SELECT * FROM payment_attempts WHERE id=$1', [id])).rows[0]
  const orderRow = async (f: F) => (await pool.query('SELECT * FROM orders WHERE id=$1', [f.order_id])).rows[0]
  const audits = async (action: string, subject?: string) => (await pool.query('SELECT * FROM audit_events WHERE action=$1 AND ($2::text IS NULL OR subject=$2) ORDER BY created_at', [action, subject ?? null])).rows
  const fulfilments = async (f: F) => (await pool.query("SELECT count(*)::int AS n FROM commercial_outbox WHERE kind='fulfillment.enqueue' AND aggregate_id=$1", [f.order_id])).rows[0].n
  const methods = async (f: F) => (await pool.query('SELECT * FROM payment_methods WHERE customer_id=$1 ORDER BY created_at', [f.customer])).rows
  const subscription = async (f: F) => (await pool.query('SELECT * FROM subscriptions WHERE id=$1', [f.subscription])).rows[0]
  const callbackOf = (attemptId: string) => `https://liwan.test/api/commercial/payment-callback?attempt=${attemptId}`
  const forge = (s: FormPaymentSession, f: F, over: Record<string, unknown> = {}) => f.adapter.directPayment({
    status: 'succeeded', amount: s.amount, description: buildAttemptDescription(s.attempt_id), callback_url: callbackOf(s.attempt_id), ...over } as any)
  const everything = async () => JSON.stringify([(await pool.query('SELECT * FROM audit_events')).rows, (await pool.query('SELECT payload FROM commercial_outbox')).rows])

  describe('opening the form', () => {
    it('reserves a form attempt with an intent and hands the browser the intent, the publishable key and the server amount', async () => {
      const f = await order()
      const s = await form(f)
      expect(s).toMatchObject({ publishable_key: 'pk_test_simulator', amount: sar(Number((await pool.query('SELECT total_minor FROM invoices WHERE id=$1', [f.invoice])).rows[0].total_minor)) })
      expect(Object.keys(s.intent).sort()).toEqual(['client_secret', 'id'])
      expect(await attemptRow(s.attempt_id)).toMatchObject({ kind: 'form', status: 'pending', provider_intent_ref: s.intent.id, save_card: false, consent_at: null, redirect_url: null })
      expect(new Date(s.expires_at).getTime()).toBeLessThanOrEqual(Date.now() + 55 * 60_000)
    })
    it('records the consent the server saw when the card is to be kept, and refuses without a consent text version', async () => {
      const f = await order()
      await expect(createPaymentAttempt(pool, { ...f.input, request: { method: 'form', save_card: true } as any })).rejects.toMatchObject({ status: 422, code: 'consent_required' })
      const s = await form(f, saving)
      expect(await attemptRow(s.attempt_id)).toMatchObject({ save_card: true, consent_text_version: 'v1' })
      expect((await attemptRow(s.attempt_id)).consent_at).toBeInstanceOf(Date)
    })
    it('refuses to save the card when the plan does not allow auto-renew, and writes nothing', async () => {
      const f = await order(false)
      await expect(form(f, saving)).rejects.toMatchObject({ status: 409, code: 'auto_renew_not_allowed' })
      expect((await pool.query('SELECT count(*)::int AS n FROM payment_attempts WHERE order_id=$1', [f.order_id])).rows[0].n).toBe(0)
      expect((await form(f)).attempt_id).toBeTruthy() // paying without keeping the card is still fine
    })
    it('refuses an order that is not awaiting payment and a deployment without a publishable key', async () => {
      const f = await order()
      await pool.query("UPDATE orders SET payment_state='paid' WHERE id=$1", [f.order_id])
      await expect(form(f)).rejects.toMatchObject({ status: 409, code: 'payment_not_awaiting' })
      const g = await order()
      Object.defineProperty(g.adapter, 'publishableKey', { value: null })
      await expect(form(g)).rejects.toMatchObject({ status: 409, code: 'card_form_unavailable' })
    })
    it('a repeated request returns the same attempt and a usable intent; a double submit leaves one attempt and one live intent', async () => {
      const f = await order()
      const first = await form(f)
      const again = await form(f)
      expect(again.attempt_id).toBe(first.attempt_id)
      expect(again.intent.id).toBe(first.intent.id)
      const g = await order()
      const [a, b] = await Promise.all([form(g), form(g)])
      expect(a.attempt_id).toBe(b.attempt_id)
      expect(a.intent.id).toBe(b.intent.id)
      expect((await pool.query('SELECT count(*)::int AS n FROM payment_attempts WHERE order_id=$1', [g.order_id])).rows[0].n).toBe(1)
      expect((await g.adapter.getIntent(a.intent.id)).status).toBe('created')
    })
    it('re-entry changes what the customer asked for while nothing is paid', async () => {
      const f = await order()
      const s = await form(f)
      await form(f, saving)
      expect(await attemptRow(s.attempt_id)).toMatchObject({ save_card: true, consent_text_version: 'v1' })
      await form(f)
      expect(await attemptRow(s.attempt_id)).toMatchObject({ save_card: false, consent_at: null, consent_text_version: null })
    })
    it.each(['consumed', 'cancelled', 'expired'] as const)('a %s intent is replaced on the same attempt row', async how => {
      const f = await order()
      const s = await form(f)
      if (how === 'consumed') fulfil(f, s, { card: { outcome: 'declined', message: 'DECLINED' } })
      if (how === 'cancelled') await f.adapter.cancelIntent(s.intent.id)
      if (how === 'expired') (f.adapter as any).intents.get(s.intent.id).expires_at = new Date(Date.now() - 1000).toISOString()
      const next = await form(f)
      expect(next.attempt_id).toBe(s.attempt_id)
      expect(next.intent.id).not.toBe(s.intent.id)
      expect((await f.adapter.getIntent(next.intent.id)).status).toBe('created')
      expect((await attemptRow(s.attempt_id)).provider_intent_ref).toBe(next.intent.id)
      if (how === 'expired') expect((await f.adapter.getIntent(s.intent.id)).status).toBe('canceled')
    })
    it('an attempt past its lifetime is closed and a fresh attempt is opened; the order stays payable', async () => {
      const f = await order()
      const s = await form(f)
      await pool.query("UPDATE payment_attempts SET created_at=now()-interval '56 minutes' WHERE id=$1", [s.attempt_id])
      const next = await form(f)
      expect(next.attempt_id).not.toBe(s.attempt_id)
      expect(await attemptRow(s.attempt_id)).toMatchObject({ status: 'canceled' })
      expect((await f.adapter.getIntent(s.intent.id)).status).toBe('canceled')
      expect((await orderRow(f)).payment_state).toBe('awaiting_payment')
    })
  })

  describe('settlement', () => {
    it('settles a payment the callback names, without keeping the card; the audit event records the 3-D Secure result as unknown', async () => {
      const f = await order()
      const s = await form(f)
      const p = fulfil(f, s)
      expect(await hint(f, s.attempt_id, p.payment_id)).toMatchObject({ payment_state: 'paid', fulfillment_state: 'queued' })
      expect(await attemptRow(s.attempt_id)).toMatchObject({ status: 'succeeded', provider_ref: p.payment_id })
      expect(await methods(f)).toEqual([])
      expect((await subscription(f)).auto_renew_enabled).toBe(false)
      expect((await audits('payment.form_settled', f.order_id))[0].metadata).toMatchObject({ attempt_id: s.attempt_id, payment_id: p.payment_id, authenticated: null, card: 'none' })
      expect(await fulfilments(f)).toBe(1)
    })
    it('keeps the card and turns auto-renew on when the attempt asked for it, from a webhook alone', async () => {
      const f = await order()
      const s = await form(f, saving)
      const p = fulfil(f, s, { saveCard: true })
      expect(await webhook(f, p.payment_id)).toEqual({ status: 200, outcome: 'accepted' })
      const [saved, ...rest] = await methods(f)
      expect(rest).toEqual([])
      expect(saved).toMatchObject({ provider_token: p.token, brand: 'visa', last_four: '4242', status: 'active', is_default: true, consent_text_version: 'v1', source_attempt_id: s.attempt_id })
      expect(saved.consent_at).toEqual((await attemptRow(s.attempt_id)).consent_at)
      expect(await subscription(f)).toMatchObject({ auto_renew_enabled: true })
      expect((await subscription(f)).auto_renew_consent_at).toEqual(saved.consent_at)
      expect(await audits('payment_method.saved', f.customer)).toHaveLength(1)
      expect(await audits('auto_renew.enabled', f.subscription)).toHaveLength(1)
      expect(await everything()).not.toContain(p.token)
    })
    it('the subscription row exists before payment, so auto-renew is set in the settlement transaction of a first order', async () => {
      const f = await order()
      expect((await subscription(f)).state).toBe('pending')
      const s = await form(f, saving)
      await webhook(f, fulfil(f, s, { saveCard: true }).payment_id)
      expect((await subscription(f)).auto_renew_enabled).toBe(true)
    })
    it('a webhook before the callback and a callback before the webhook each give one settlement', async () => {
      for (const order_ of ['webhook-first', 'callback-first']) {
        const f = await order()
        const s = await form(f)
        const p = fulfil(f, s)
        if (order_ === 'webhook-first') { await webhook(f, p.payment_id); await hint(f, s.attempt_id, p.payment_id) }
        else { await hint(f, s.attempt_id, p.payment_id); expect(await webhook(f, p.payment_id)).toMatchObject({ status: 200 }) }
        expect(await fulfilments(f)).toBe(1)
        expect((await pool.query("SELECT count(*)::int AS n FROM payment_attempts WHERE order_id=$1 AND status='succeeded'", [f.order_id])).rows[0].n).toBe(1)
        expect((await pool.query('SELECT count(*)::int AS n FROM payment_events WHERE provider_event_id LIKE $1', [`%${p.payment_id}%`])).rows[0].n).toBeLessThanOrEqual(1)
        expect(await webhook(f, p.payment_id)).toMatchObject({ status: 200 })
        expect(await fulfilments(f)).toBe(1)
      }
    })
    it('a callback and a webhook racing for one payment settle it once', async () => {
      const f = await order()
      const s = await form(f, saving)
      const p = fulfil(f, s, { saveCard: true })
      await Promise.all([hint(f, s.attempt_id, p.payment_id), webhook(f, p.payment_id)])
      expect(await fulfilments(f)).toBe(1)
      expect(await methods(f)).toHaveLength(1)
    })
    it('a declined payment changes nothing and the customer can try again with a fresh intent', async () => {
      const f = await order()
      const s = await form(f)
      const declined = fulfil(f, s, { card: { outcome: 'declined', message: 'INSUFFICIENT FUNDS' } })
      await hint(f, s.attempt_id, declined.payment_id)
      expect(await webhook(f, declined.payment_id)).toEqual({ status: 200, outcome: 'ignored' })
      expect(await orderRow(f)).toMatchObject({ payment_state: 'awaiting_payment' })
      const retry = await form(f)
      expect(retry.attempt_id).toBe(s.attempt_id)
      await hint(f, s.attempt_id, fulfil(f, retry).payment_id)
      expect(await orderRow(f)).toMatchObject({ payment_state: 'paid' })
    })
  })

  describe('forgeries', () => {
    const rejected = async (f: F, s: FormPaymentSession, reason: string) => {
      expect(await attemptRow(s.attempt_id)).toMatchObject({ provider_ref: null, status: 'pending' })
      expect(await orderRow(f)).toMatchObject({ payment_state: 'awaiting_payment' })
      expect((await audits('payment.form_hint_rejected')).map(r => r.metadata.reason)).toContain(reason)
      expect(await methods(f)).toEqual([])
    }
    it('another order\'s payment id as the hint is refused, and leaves that order\'s own settlement alone', async () => {
      const a = await order(), b = await order(true, a.adapter)
      const sa = await form(a), sb = await form(b)
      const pb = fulfil(b, sb)
      await hint(b, sb.attempt_id, pb.payment_id)
      await hint(a, sa.attempt_id, pb.payment_id) // B's real, settled payment replayed on A's return
      await rejected(a, sa, 'attempt_mismatch')
      expect(await orderRow(b)).toMatchObject({ payment_state: 'paid' })
    })
    it('a cheaper payment that copies the description and callback is refused', async () => {
      const f = await order()
      const s = await form(f)
      await hint(f, s.attempt_id, forge(s, f, { amount: sar(100) }).payment_id)
      await rejected(f, s, 'amount_mismatch')
    })
    it('the wrong callback, the wrong currency, the wrong mode and an unrecognised description are refused', async () => {
      const f = await order()
      const s = await form(f)
      const cases: [Record<string, unknown>, string][] = [
        [{ callback_url: 'https://evil.test/api/commercial/payment-callback?attempt=' + s.attempt_id }, 'callback_mismatch'],
        [{ callback_url: callbackOf(randomUUID()) }, 'callback_mismatch'],
        [{ amount: { ...s.amount, currency: 'USD' } }, 'amount_mismatch'],
        [{ live: true }, 'mode_mismatch'],
        [{ description: 'HACKED' }, 'description_unrecognized'],
      ]
      for (const [over, reason] of cases) {
        await hint(f, s.attempt_id, forge(s, f, over).payment_id)
        await rejected(f, s, reason)
      }
    })
    it('a payment already tied to another attempt is refused', async () => {
      const f = await order(), g = await order()
      const s = await form(f)
      const other = await form(g)
      const p = forge(s, f)
      await pool.query('UPDATE payment_attempts SET provider_ref=$2 WHERE id=$1', [other.attempt_id, p.payment_id])
      await hint(f, s.attempt_id, p.payment_id)
      await rejected(f, s, 'payment_bound_elsewhere')
    })
    it('a hint of the wrong shape or for a payment the provider does not know is refused', async () => {
      const f = await order()
      const s = await form(f)
      await hint(f, s.attempt_id, 'x y; DROP')
      await rejected(f, s, 'bad_shape')
      await hint(f, s.attempt_id, 'sim_pay_unknown_999')
      await rejected(f, s, 'payment_not_found')
    })
    it('a webhook for a forged payment is neither settled nor recorded as a final event, and every redelivery is answered the same way', async () => {
      const f = await order()
      const s = await form(f)
      const forged = forge(s, f, { amount: sar(100) })
      for (let i = 0; i < 2; i++) expect(await webhook(f, forged.payment_id)).toEqual({ status: 409, outcome: 'unmatched' })
      const stranger = forge(s, f, { description: buildAttemptDescription(randomUUID()) })
      expect(await webhook(f, stranger.payment_id)).toEqual({ status: 409, outcome: 'unmatched' })
      expect((await pool.query('SELECT count(*)::int AS n FROM payment_events')).rows[0].n).toBe(0)
      expect((await audits('payment.form_payment_rejected')).length).toBeGreaterThanOrEqual(3)
      expect(await orderRow(f)).toMatchObject({ payment_state: 'awaiting_payment' })
    })
    it('a full-price payment made straight with the publishable key that carries the intent\'s description and callback does settle (it is a real payment)', async () => {
      const f = await order()
      const s = await form(f)
      await hint(f, s.attempt_id, forge(s, f).payment_id)
      expect(await orderRow(f)).toMatchObject({ payment_state: 'paid' })
    })
  })

  describe('the card of a settled payment', () => {
    it('deletes a token the attempt did not ask for, settles the payment and audits it', async () => {
      const f = await order()
      const s = await form(f)
      const p = fulfil(f, s, { saveCard: true }) // the browser tampered: the row says no card
      await hint(f, s.attempt_id, p.payment_id)
      expect(await orderRow(f)).toMatchObject({ payment_state: 'paid' })
      expect(await methods(f)).toEqual([])
      expect(await audits('payment.token_orphan_deleted', f.order_id)).toHaveLength(1)
      await expect(f.adapter.getToken(p.token!)).rejects.toMatchObject({ code: 'not_found' })
      expect(await everything()).not.toContain(p.token)
    })
    it('does not save a token that is not active, and deletes it', async () => {
      const f = await order()
      const s = await form(f, saving)
      const p = fulfil(f, s, { saveCard: true })
      f.adapter.addToken(p.token!, 'inactive')
      await webhook(f, p.payment_id)
      expect(await orderRow(f)).toMatchObject({ payment_state: 'paid' })
      expect(await methods(f)).toEqual([])
      expect((await subscription(f)).auto_renew_enabled).toBe(false)
      expect((await audits('payment.card_not_saved', f.order_id))[0].metadata).toMatchObject({ reason: 'token_not_active' })
      await expect(f.adapter.getToken(p.token!)).rejects.toMatchObject({ code: 'not_found' })
    })
    it('a failure reading the token never blocks settlement', async () => {
      const f = await order()
      const s = await form(f, saving)
      const p = fulfil(f, s, { saveCard: true })
      vi.spyOn(f.adapter, 'getToken').mockRejectedValue(Object.assign(new Error('boom'), { code: 'provider_unreachable' }))
      vi.spyOn(console, 'error').mockImplementation(() => {})
      await webhook(f, p.payment_id)
      expect(await orderRow(f)).toMatchObject({ payment_state: 'paid' })
      expect(await methods(f)).toEqual([])
      expect((await audits('payment.card_not_saved', f.order_id))[0].metadata).toMatchObject({ reason: 'token_read_failed' })
    })
    it('audits a card that was asked for but never came', async () => {
      const f = await order()
      const s = await form(f, saving)
      await webhook(f, fulfil(f, s).payment_id) // the browser did not ask the provider to save it
      expect(await orderRow(f)).toMatchObject({ payment_state: 'paid' })
      expect((await audits('payment.card_not_saved', f.order_id))[0].metadata).toMatchObject({ reason: 'token_missing' })
    })
    it('a new card replaces the default card, whose token is deleted at the provider after the commit', async () => {
      const f = await order()
      await seedPaymentMethod(pool, f.customer, 'sim_old_token')
      f.adapter.addToken('sim_old_token')
      const s = await form(f, saving)
      await webhook(f, fulfil(f, s, { saveCard: true }).payment_id)
      const rows = await methods(f)
      expect(rows.map(r => [r.provider_token === 'sim_old_token', r.status, r.is_default])).toEqual([[true, 'removed', false], [false, 'active', true]])
      expect(rows[0].removed_by).toBe('system')
      await expect(f.adapter.getToken('sim_old_token')).rejects.toMatchObject({ code: 'not_found' })
    })
    it('a failed deletion is logged, kept and retried until it works, and then the token leaves the queue', async () => {
      const f = await order()
      await seedPaymentMethod(pool, f.customer, 'sim_old_token')
      f.adapter.addToken('sim_old_token')
      const failing = vi.spyOn(f.adapter, 'deleteToken').mockRejectedValue(Object.assign(new Error('down'), { code: 'provider_unreachable' }))
      const log = vi.spyOn(console, 'error').mockImplementation(() => {})
      const s = await form(f, saving)
      await webhook(f, fulfil(f, s, { saveCard: true }).payment_id)
      expect(await orderRow(f)).toMatchObject({ payment_state: 'paid' })
      expect(log.mock.calls.flat().join(' ')).toContain('payment_token_delete_failed')
      expect(log.mock.calls.flat().join(' ')).not.toContain('sim_old_token')
      const pending = (await pool.query("SELECT * FROM commercial_outbox WHERE kind='payment_token.delete'")).rows[0]
      expect(pending).toMatchObject({ status: 'pending', attempts: 1 })
      failing.mockRestore()
      await pool.query('UPDATE commercial_outbox SET next_attempt_at=now() WHERE id=$1', [pending.id])
      expect(await processTokenDeletions(pool, f.adapter)).toBe(1)
      const done = (await pool.query('SELECT * FROM commercial_outbox WHERE id=$1', [pending.id])).rows[0]
      expect(done.status).toBe('done')
      expect(JSON.stringify(done.payload)).not.toContain('sim_old_token')
      await expect(f.adapter.getToken('sim_old_token')).rejects.toMatchObject({ code: 'not_found' })
    })
  })

  describe('closing, switching, reconciling and late payments', () => {
    it('the reconciler closes an unpaid form attempt only after its lifetime, without any provider payment call', async () => {
      const f = await order()
      const s = await form(f)
      const read = vi.spyOn(f.adapter, 'readPayment')
      await pool.query("UPDATE payment_attempts SET updated_at=now()-interval '1 hour' WHERE id=$1", [s.attempt_id])
      expect(await reconcileUnknownAttempts(pool, f.adapter)).toEqual([{ id: s.attempt_id, outcome: 'ignored' }])
      expect(await attemptRow(s.attempt_id)).toMatchObject({ status: 'pending' })
      await pool.query("UPDATE payment_attempts SET created_at=now()-interval '56 minutes',updated_at=now()-interval '1 hour' WHERE id=$1", [s.attempt_id])
      await reconcileUnknownAttempts(pool, f.adapter)
      expect(await attemptRow(s.attempt_id)).toMatchObject({ status: 'canceled' })
      expect(read).not.toHaveBeenCalled()
      expect(await orderRow(f)).toMatchObject({ payment_state: 'awaiting_payment' })
    })
    it('a payment that arrives after the attempt was closed is still settled', async () => {
      const f = await order()
      const s = await form(f)
      vi.spyOn(f.adapter, 'cancelIntent').mockRejectedValueOnce(new Error('provider down'))
      vi.spyOn(console, 'error').mockImplementation(() => {})
      await pool.query("UPDATE payment_attempts SET created_at=now()-interval '56 minutes',updated_at=now()-interval '1 hour' WHERE id=$1", [s.attempt_id])
      await reconcileUnknownAttempts(pool, f.adapter)
      expect(await attemptRow(s.attempt_id)).toMatchObject({ status: 'canceled' })
      expect(await webhook(f, fulfil(f, s).payment_id)).toEqual({ status: 200, outcome: 'accepted' })
      expect(await orderRow(f)).toMatchObject({ payment_state: 'paid', paid_attempt_id: s.attempt_id })
      expect(await attemptRow(s.attempt_id)).toMatchObject({ status: 'succeeded' })
    })
    it('a late payment on an order another attempt already paid is a duplicate charge with a credit note', async () => {
      const f = await order()
      const s = await form(f)
      vi.spyOn(f.adapter, 'cancelIntent').mockRejectedValueOnce(new Error('provider down'))
      vi.spyOn(console, 'error').mockImplementation(() => {})
      await pool.query("UPDATE payment_attempts SET created_at=now()-interval '56 minutes',updated_at=now()-interval '1 hour' WHERE id=$1", [s.attempt_id])
      await reconcileUnknownAttempts(pool, f.adapter)
      const next = await form(f)
      await webhook(f, fulfil(f, next).payment_id)
      expect((await orderRow(f)).paid_attempt_id).toBe(next.attempt_id)
      expect(await webhook(f, fulfil(f, s).payment_id)).toEqual({ status: 200, outcome: 'accepted' })
      expect(await audits('payment.duplicate_charge', f.order_id)).toHaveLength(1)
      expect(await fulfilments(f)).toBe(1)
      await processRefundOutbox(pool, f.adapter)
      expect((await pool.query('SELECT kind,status,amount_minor::int AS minor FROM invoice_adjustments WHERE invoice_id=$1', [f.invoice])).rows).toEqual([{ kind: 'credit_note', status: 'pending', minor: s.amount.minor }])
    })
    it('two payments on one attempt (a replaced intent that was paid after all) settle one and record the other as a duplicate', async () => {
      const f = await order()
      const first = await form(f)
      const lost = fulfil(f, first) // paid, but its callback and webhook never arrived
      const second = await form(f) // the consumed intent is replaced on the same row
      expect(second.attempt_id).toBe(first.attempt_id)
      const kept = fulfil(f, second)
      await webhook(f, kept.payment_id)
      expect(await webhook(f, lost.payment_id)).toEqual({ status: 200, outcome: 'accepted' })
      expect((await orderRow(f)).paid_attempt_id).toBe(first.attempt_id)
      expect(await audits('payment.duplicate_charge', f.order_id)).toHaveLength(1)
      expect(await fulfilments(f)).toBe(1)
      await processRefundOutbox(pool, f.adapter)
      expect((await pool.query('SELECT count(*)::int AS n FROM invoice_adjustments WHERE invoice_id=$1', [f.invoice])).rows[0].n).toBe(1)
    })
    it('a hosted invoice is closed at the provider when the card form is asked for, and the form is opened', async () => {
      const f = await order()
      const hosted = await createPaymentAttempt(pool, f.input)
      const s = await form(f)
      expect(await attemptRow(hosted.id)).toMatchObject({ status: 'canceled' })
      expect(s.attempt_id).not.toBe(hosted.id)
      expect((await f.adapter.lookupAttempt(hosted.provider_ref!)).status).toBe('canceled')
    })
    it('a hosted invoice that may be paid is never closed for the form: a paid one settles, one that cannot be cancelled stays', async () => {
      const f = await order()
      const hosted = await createPaymentAttempt(pool, f.input)
      f.adapter.settle(hosted.provider_ref!, 'succeeded') // paid at the provider, no webhook yet
      await expect(form(f)).rejects.toMatchObject({ status: 409, code: 'payment_not_awaiting' })
      expect(await orderRow(f)).toMatchObject({ payment_state: 'paid' })
      const g = await order()
      const live = await createPaymentAttempt(pool, g.input)
      vi.spyOn(g.adapter, 'cancelAttempt').mockRejectedValue(new Error('invoice already paid'))
      await expect(form(g)).rejects.toMatchObject({ status: 409, code: 'payment_in_progress' })
      expect(await attemptRow(live.id)).toMatchObject({ status: 'redirected' })
    })
    it('an open card form is closed, intent cancelled, when a hosted invoice is asked for', async () => {
      const f = await order()
      const s = await form(f)
      const hosted = await createPaymentAttempt(pool, f.input)
      expect(hosted.kind).toBe('hosted_invoice')
      expect(await attemptRow(s.attempt_id)).toMatchObject({ status: 'canceled' })
      expect((await f.adapter.getIntent(s.intent.id)).status).toBe('canceled')
    })
    it('an open card form whose intent was fulfilled is never closed for a hosted invoice: a payment may exist', async () => {
      const f = await order()
      const s = await form(f)
      fulfil(f, s) // paid or being authenticated; nothing can say which
      await expect(createPaymentAttempt(pool, f.input)).rejects.toMatchObject({ status: 409, code: 'payment_in_progress' })
      expect(await attemptRow(s.attempt_id)).toMatchObject({ status: 'pending' })
    })
  })

  describe('refunds', () => {
    it('a first payment made through the form is returned through the provider, and its card is not kept', async () => {
      const f = await order()
      const s = await form(f, saving)
      await pool.query('UPDATE orders SET cancelled=true,automatic_refund=true WHERE id=$1', [f.order_id]) // cancelled while the payer was typing
      const p = fulfil(f, s, { saveCard: true })
      await webhook(f, p.payment_id)
      expect(await orderRow(f)).toMatchObject({ payment_state: 'refund_pending' })
      expect(await methods(f)).toEqual([])
      const refund = vi.spyOn(f.adapter, 'refund')
      await processRefundOutbox(pool, f.adapter)
      expect(refund).toHaveBeenCalledWith(p.payment_id, expect.objectContaining({ minor: s.amount.minor }))
      expect(await orderRow(f)).toMatchObject({ payment_state: 'refunded' })
      expect((await f.adapter.readPayment(p.payment_id)).status).toBe('refunded')
    })
  })
})
