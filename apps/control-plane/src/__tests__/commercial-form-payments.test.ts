// Card form payments on live PostgreSQL, against the payment simulator: no provider call, no key. Every settlement here comes from a payment
// fetched back from the (simulated) provider; the browser's hint and the webhook body only name a payment to fetch.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { Pool } from 'pg'
import { CURRENT_CONSENT_TEXT_VERSION, paymentAttemptRequestSchema, type FormPaymentSession, type PaymentAttemptRequest } from '@liwan/commercial-contracts'
import { client, money, monthly, seedPaymentMethod, setup, url } from './commercial-helpers.js'
import { acceptQuote } from '../commercial/orders.js'
import { createQuoteForCustomer } from '../commercial/quotes.js'
import { PaymentError } from '../commercial/payment-adapter.js'
import { SimulatorAdapter } from '../commercial/payment-simulator.js'
import { buildAttemptDescription } from '../commercial/payment-description.js'
import { createPaymentAttempt, handleProviderEvent, reconcileUnknownAttempts, verifyReturnedAttempt } from '../commercial/payments.js'
import { cancelOrder } from '../commercial/orders.js'
import { removePaymentMethod } from '../commercial/payment-method-removal.js'
import { processTokenDeletions, resolveFormPayment, REJECTION_SUPPRESSED_ACTION } from '../commercial/form-payments.js'
import { allAttentionItems } from '../commercial/attention.js'
import { sendVendorAlerts } from '../commercial/vendor-alerts.js'
import { attention } from '../commercial/attention.js'
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
  beforeEach(async () => {
    vi.restoreAllMocks(); await pool.query('TRUNCATE customers CASCADE'); await pool.query('TRUNCATE commercial_outbox')
    // Rejections naming no order belong to no customer, so nothing above removes them: each test starts without the earlier ones'.
    await pool.query("DELETE FROM audit_events WHERE action LIKE 'payment.form%'")
  })
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
  const ACTOR = '7'
  const form = (f: F, over: Partial<PaymentAttemptRequest> = {}, actor = ACTOR): Promise<FormPaymentSession> =>
    createPaymentAttempt(pool, { ...f.input, actor, request: paymentAttemptRequestSchema.parse({ method: 'form', ...over }) as PaymentAttemptRequest & { method: 'form' } })
  const saving = { save_card: true, consent_text_version: CURRENT_CONSENT_TEXT_VERSION }
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
  const consumeIntent = (f: F, s: FormPaymentSession) => fulfil(f, s, { card: { outcome: 'declined', message: 'DECLINED' } })
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
      await expect(createPaymentAttempt(pool, { ...f.input, actor: ACTOR, request: { method: 'form', save_card: true } as any })).rejects.toMatchObject({ status: 422, code: 'consent_required' })
      const s = await form(f, saving)
      expect(await attemptRow(s.attempt_id)).toMatchObject({ save_card: true, consent_text_version: CURRENT_CONSENT_TEXT_VERSION })
      expect((await attemptRow(s.attempt_id)).consent_at).toBeInstanceOf(Date)
    })
    it('refuses a consent text version the server does not know with 422 consent_version_unknown, and writes nothing', async () => {
      const f = await order()
      for (const version of ['v1', '2026-01-01'])
        await expect(form(f, { save_card: true, consent_text_version: version })).rejects.toMatchObject({ status: 422, code: 'consent_version_unknown' })
      expect((await pool.query('SELECT count(*)::int AS n FROM payment_attempts WHERE order_id=$1', [f.order_id])).rows[0].n).toBe(0)
      expect((await form(f, saving)).attempt_id).toBeTruthy()
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
      expect(await attemptRow(s.attempt_id)).toMatchObject({ save_card: true, consent_text_version: CURRENT_CONSENT_TEXT_VERSION })
      await form(f)
      expect(await attemptRow(s.attempt_id)).toMatchObject({ save_card: false, consent_at: null, consent_text_version: null })
    })
    it.each(['declined', 'cancelled', 'expired'] as const)('a %s intent is replaced on the same attempt row, with a secret of its own', async how => {
      const f = await order()
      const s = await form(f)
      const oldSecret = (await attemptRow(s.attempt_id)).callback_secret
      if (how === 'declined') await hint(f, s.attempt_id, fulfil(f, s, { card: { outcome: 'declined', message: 'DECLINED' } }).payment_id)
      if (how === 'cancelled') await f.adapter.cancelIntent(s.intent.id)
      if (how === 'expired') (f.adapter as any).intents.get(s.intent.id).expires_at = new Date(Date.now() - 1000).toISOString()
      const next = await form(f)
      expect(next.attempt_id).toBe(s.attempt_id)
      expect(next.intent.id).not.toBe(s.intent.id)
      expect((await f.adapter.getIntent(next.intent.id)).status).toBe('created')
      const row = await attemptRow(s.attempt_id)
      expect(row).toMatchObject({ provider_intent_ref: next.intent.id, declined_payment_ref: null })
      expect(row.callback_secret).not.toBe(oldSecret)
      if (how === 'expired') expect((await f.adapter.getIntent(s.intent.id)).status).toBe('expired')
    })
    it('a consumed intent whose payment nobody has seen is not replaced: the customer is told a payment is in progress, and the callback settles it', async () => {
      const f = await order()
      const s = await form(f)
      const p = fulfil(f, s) // paid or being authenticated; neither the callback nor a webhook has arrived
      await expect(form(f)).rejects.toMatchObject({ status: 409, code: 'payment_in_progress' })
      expect((await attemptRow(s.attempt_id)).provider_intent_ref).toBe(s.intent.id)
      await hint(f, s.attempt_id, p.payment_id)
      expect(await orderRow(f)).toMatchObject({ payment_state: 'paid' })
    })
    it('an unrecognised intent state is treated like a consumed one', async () => {
      const f = await order()
      const s = await form(f)
      ;(f.adapter as any).intents.get(s.intent.id).status = 'unrecognized'
      await expect(form(f)).rejects.toMatchObject({ status: 409, code: 'payment_in_progress' })
    })
    it('a form cannot be opened on an attempt that expiry just closed: the new intent is cancelled and the customer gets a fresh attempt', async () => {
      const f = await order()
      const s = await form(f)
      await pool.query("UPDATE payment_attempts SET provider_intent_ref=NULL,callback_secret=NULL WHERE id=$1", [s.attempt_id])
      const create = f.adapter.createIntent.bind(f.adapter)
      vi.spyOn(f.adapter, 'createIntent').mockImplementationOnce(async i => {
        await pool.query("UPDATE payment_attempts SET status='canceled' WHERE id=$1", [i.attempt_id]) // the reconciler closed it a moment ago
        return create(i)
      })
      const next = await form(f)
      expect(next.attempt_id).not.toBe(s.attempt_id)
      expect(await attemptRow(s.attempt_id)).toMatchObject({ status: 'canceled', provider_intent_ref: null })
      expect([...(f.adapter as any).intents.values()].filter((i: any) => i.status === 'created').map((i: any) => i.id)).toContain(next.intent.id)
      expect([...(f.adapter as any).intents.values()].filter((i: any) => i.status === 'created')).toHaveLength(2) // the orphan of the first (never opened) and the new one
    })
    it('the secret of each intent stays out of the session, the attempt view and every audit row, and is in the callback the provider locked', async () => {
      const f = await order()
      const s = await form(f)
      const secret = (await attemptRow(s.attempt_id)).callback_secret as string
      expect(secret.length).toBeGreaterThanOrEqual(32)
      expect(JSON.stringify(s)).not.toContain(secret)
      expect((await f.adapter.getIntent(s.intent.id)).callback_url).toContain(`k=${secret}`)
      await hint(f, s.attempt_id, fulfil(f, s).payment_id)
      expect(await everything()).not.toContain(secret)
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
      expect((await audits('payment.form_settled', f.order_id))[0].metadata).toMatchObject({ attempt_id: s.attempt_id, payment_id: p.payment_id, authenticated: null, card: 'nothing' })
      expect(await fulfilments(f)).toBe(1)
    })
    it('keeps the card and turns auto-renew on when the attempt asked for it, from a webhook alone', async () => {
      const f = await order()
      const s = await form(f, saving)
      const p = fulfil(f, s, { saveCard: true })
      expect(await webhook(f, p.payment_id)).toEqual({ status: 200, outcome: 'accepted' })
      const [saved, ...rest] = await methods(f)
      expect(rest).toEqual([])
      expect(saved).toMatchObject({ provider_token: p.token, brand: 'visa', last_four: '4242', status: 'active', is_default: true, consent_text_version: CURRENT_CONSENT_TEXT_VERSION, source_attempt_id: s.attempt_id })
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
      expect(await webhook(f, declined.payment_id)).toEqual({ status: 200, outcome: 'ignored' })
      expect((await attemptRow(s.attempt_id)).declined_payment_ref).toBe(declined.payment_id)
      expect(await audits('payment.form_declined', f.order_id)).toHaveLength(1)
      await hint(f, s.attempt_id, declined.payment_id)
      expect(await audits('payment.form_declined', f.order_id)).toHaveLength(1)
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
    /** The payer's own intent was fulfilled and declined: nothing was charged, and the intent is consumed. */
    const consume = (f: F, s: FormPaymentSession) => fulfil(f, s, { card: { outcome: 'declined', message: 'DECLINED' } })
    const genuine = async (f: F, s: FormPaymentSession) => (await f.adapter.getIntent(s.intent.id)).callback_url
    it('another order\'s payment id as the hint is refused, and leaves that order\'s own settlement alone', async () => {
      const a = await order(), b = await order(true, a.adapter)
      const sa = await form(a), sb = await form(b)
      const pb = fulfil(b, sb)
      await hint(b, sb.attempt_id, pb.payment_id)
      await hint(a, sa.attempt_id, pb.payment_id) // B's real, settled payment replayed on A's return
      await rejected(a, sa, 'attempt_mismatch')
      expect(await orderRow(b)).toMatchObject({ payment_state: 'paid' })
    })
    it('a cheaper payment that copies the description and the genuine callback is refused', async () => {
      const f = await order()
      const s = await form(f)
      consume(f, s)
      await hint(f, s.attempt_id, forge(s, f, { amount: sar(100), callback_url: await genuine(f, s) }).payment_id)
      await rejected(f, s, 'amount_mismatch')
    })
    it('a direct payment with the right description and amount and the PUBLIC callback (no secret) is refused, saves no card and replaces nothing', async () => {
      const f = await order()
      const old = await seedPaymentMethod(pool, f.customer, 'sim_victim_card')
      f.adapter.addToken('sim_victim_card')
      const s = await form(f, saving)
      // The attacker pays with their own card straight with the public key: every field of it is derivable from the attempt id.
      const attack = forge(s, f, { token: 'sim_attacker_card' })
      f.adapter.addToken('sim_attacker_card')
      // While the victim's intent has not been fulfilled, the payment names an intent that nobody used: that can change by itself, so
      // it is answered (the provider would retry) and nothing is written, raised or remembered.
      await hint(f, s.attempt_id, attack.payment_id)
      expect(await audits('payment.form_hint_rejected', f.order_id)).toEqual([])
      // Once the victim's own attempt consumed the intent, only the missing secret stands in the way.
      consume(f, s)
      await pool.query("UPDATE payment_attempts SET updated_at=now()-interval '10 seconds' WHERE id=$1", [s.attempt_id])
      await pool.query("DELETE FROM audit_events WHERE action='payment.form_hint_rejected'") // the same payment id is remembered for a few minutes; the intent has changed since
      await hint(f, s.attempt_id, attack.payment_id)
      expect((await audits('payment.form_hint_rejected', f.order_id)).map(r => r.metadata.reason)).toEqual(['callback_mismatch'])
      expect(await attemptRow(s.attempt_id)).toMatchObject({ provider_ref: null, status: 'pending' })
      expect(await orderRow(f)).toMatchObject({ payment_state: 'awaiting_payment' })
      expect(await webhook(f, attack.payment_id)).toEqual({ status: 409, outcome: 'unmatched' })
      expect((await methods(f)).map(r => [r.id === old, r.provider_token, r.status, r.is_default])).toEqual([[true, 'sim_victim_card', 'active', true]])
      expect((await subscription(f)).auto_renew_enabled).toBe(false)
      await expect(f.adapter.getToken('sim_victim_card')).resolves.toMatchObject({ active: true })
      expect(await fulfilments(f)).toBe(0)
    })
    it('a payment whose callback carries another attempt\'s secret is refused', async () => {
      const f = await order(), g = await order(true, f.adapter)
      const s = await form(f), other = await form(g)
      consume(f, s)
      const stolen = (await attemptRow(other.attempt_id)).callback_secret
      await hint(f, s.attempt_id, forge(s, f, { callback_url: `${callbackOf(s.attempt_id)}&k=${stolen}` }).payment_id)
      await rejected(f, s, 'callback_mismatch')
    })
    it('the wrong callback, the wrong currency, the wrong mode and an unrecognised description are refused', async () => {
      const f = await order()
      const s = await form(f)
      consume(f, s)
      const cases: [Record<string, unknown>, string][] = [
        [{ callback_url: 'https://evil.test/api/commercial/payment-callback?attempt=' + s.attempt_id }, 'callback_mismatch'],
        [{ callback_url: callbackOf(randomUUID()) }, 'callback_mismatch'],
        [{ callback_url: `${await genuine(f, s)}&extra=1` }, 'callback_mismatch'],
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
      consume(f, s)
      const p = forge(s, f, { callback_url: await genuine(f, s) })
      await pool.query('UPDATE payment_attempts SET provider_ref=$2 WHERE id=$1', [other.attempt_id, p.payment_id])
      await hint(f, s.attempt_id, p.payment_id)
      await rejected(f, s, 'payment_bound_elsewhere')
    })
    it('the loser of a race for one payment id gets the typed refusal, not a raw database error', async () => {
      const f = await order(), g = await order(true, f.adapter)
      const s = await form(f), other = await form(g)
      const p = fulfil(f, s)
      // Another attempt claims the id between the check and the update: the unique index answers.
      const real = pool.query.bind(pool)
      vi.spyOn(pool, 'query').mockImplementation(((sql: any, ...rest: any[]) => {
        if (typeof sql === 'string' && sql.startsWith('SELECT 1 FROM payment_attempts WHERE provider=$1 AND provider_ref=$2')) {
          return real('UPDATE payment_attempts SET provider_ref=$2 WHERE id=$1', [other.attempt_id, p.payment_id]).then(() => ({ rowCount: 0, rows: [] }))
        }
        return (real as any)(sql, ...rest)
      }) as any)
      await hint(f, s.attempt_id, p.payment_id)
      vi.restoreAllMocks()
      await rejected(f, s, 'payment_bound_elsewhere')
    })
    it('a second payment on an attempt that already has one is refused and audited, never settled twice', async () => {
      const f = await order()
      const s = await form(f)
      await hint(f, s.attempt_id, fulfil(f, s).payment_id)
      const again = forge(s, f, { callback_url: await genuine(f, s) })
      expect(await webhook(f, again.payment_id)).toEqual({ status: 409, outcome: 'unmatched' })
      expect((await audits('payment.form_payment_rejected', f.order_id)).map(r => r.metadata.reason)).toContain('attempt_has_other_payment')
      expect(await fulfilments(f)).toBe(1)
    })
    it('a hint of the wrong shape or for a payment the provider does not know is refused', async () => {
      const f = await order()
      const s = await form(f)
      await hint(f, s.attempt_id, 'x y; DROP')
      await rejected(f, s, 'bad_shape')
      await hint(f, s.attempt_id, 'sim_pay_unknown_999')
      // A payment the provider cannot read yet may still appear: nothing is written for it.
      expect((await audits('payment.form_hint_rejected')).map(r => r.metadata.reason)).not.toContain('payment_not_found')
      expect(await attemptRow(s.attempt_id)).toMatchObject({ provider_ref: null, status: 'pending' })
    })
    it('a webhook for a forged payment is neither settled nor recorded as a final event, and every redelivery is answered the same way', async () => {
      const f = await order()
      const s = await form(f)
      const forged = forge(s, f, { amount: sar(100) })
      for (let i = 0; i < 2; i++) expect(await webhook(f, forged.payment_id)).toEqual({ status: 409, outcome: 'unmatched' })
      const stranger = forge(s, f, { description: buildAttemptDescription(randomUUID()) })
      expect(await webhook(f, stranger.payment_id)).toEqual({ status: 409, outcome: 'unmatched' })
      expect((await pool.query('SELECT count(*)::int AS n FROM payment_events')).rows[0].n).toBe(0)
      expect((await audits('payment.form_payment_rejected')).length).toBeGreaterThanOrEqual(2)
      expect(await orderRow(f)).toMatchObject({ payment_state: 'awaiting_payment' })
    })
    it('repeated rejections add one audit row and one provider fetch per payment, however often the provider retries', async () => {
      const f = await order()
      const s = await form(f)
      const forged = forge(s, f, { amount: sar(100) })
      const read = vi.spyOn(f.adapter, 'readPayment')
      for (let i = 0; i < 6; i++) expect(await webhook(f, forged.payment_id)).toEqual({ status: 409, outcome: 'unmatched' })
      expect(read).toHaveBeenCalledTimes(1)
      expect(await audits('payment.form_payment_rejected', f.order_id)).toHaveLength(1)
      for (let i = 0; i < 4; i++) await hint(f, s.attempt_id, forged.payment_id)
      expect(await audits('payment.form_hint_rejected', f.order_id)).toHaveLength(1)
      expect(read).toHaveBeenCalledTimes(2) // the hint source has its own memory
    })
    it('a hosted invoice\'s webhook that arrives before its reference is saved never meets the form resolver', async () => {
      const f = await order()
      const hosted = await createPaymentAttempt(pool, f.input)
      f.adapter.settle(hosted.provider_ref!, 'succeeded')
      const body = f.adapter.webhookBody(hosted.provider_ref!)
      await pool.query('UPDATE payment_attempts SET provider_ref=NULL WHERE id=$1', [hosted.id])
      const read = vi.spyOn(f.adapter, 'readPayment')
      const lookup = vi.spyOn(f.adapter, 'lookupAttempt')
      expect(await handleProviderEvent(pool, { provider: 'simulator', adapter: f.adapter, rawBody: body, headers: {} })).toMatchObject({ status: 200 })
      expect(read).not.toHaveBeenCalled()
      expect(lookup).toHaveBeenCalled()
      expect((await pool.query("SELECT count(*)::int AS n FROM audit_events WHERE action LIKE 'payment.form_%' AND subject=$1", [f.order_id])).rows[0].n).toBe(0)
    })
    it('a refunded webhook for an unclaimed form payment: fully refunded owes nothing, partly refunded is money held and is audited', async () => {
      const f = await order()
      const s = await form(f)
      const full = forge(s, f)
      await f.adapter.refund(full.payment_id)
      expect(await webhook(f, full.payment_id)).toEqual({ status: 200, outcome: 'ignored' })
      expect(await audits('payment.form_payment_rejected', f.order_id)).toHaveLength(0)
      const part = forge(s, f)
      await f.adapter.refund(part.payment_id, sar(3000))
      expect(await webhook(f, part.payment_id)).toEqual({ status: 409, outcome: 'unmatched' })
      expect((await audits('payment.form_payment_rejected', f.order_id))[0].metadata).toMatchObject({ reason: 'refunded_unclaimed', payment_id: part.payment_id })
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
      expect(rows.map(r => [r.status, r.is_default, r.provider_token === null])).toEqual([['removed', false, true], ['active', true, false]]) // the removed card forgot its token once the provider deleted it
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
      expect((await methods(f))[0].provider_token).toBeNull()
    })
    /** A second awaiting order of the same customer (the same subscription and plan), with its own issued invoice. */
    async function secondOrder(f: F) {
      const id = randomUUID(), invoice = randomUUID()
      await pool.query(`INSERT INTO orders SELECT (jsonb_populate_record(null::orders, to_jsonb(o) || $2::jsonb)).* FROM orders o WHERE o.id=$1`,
        [f.order_id, JSON.stringify({ id, quote_id: randomUUID(), idempotency_key: randomUUID(), paid_attempt_id: null, payment_state: 'awaiting_payment', fulfillment_state: 'not_started' })])
      await pool.query(`INSERT INTO invoices SELECT (jsonb_populate_record(null::invoices, to_jsonb(i) || $2::jsonb)).* FROM invoices i WHERE i.id=$1`,
        [f.invoice, JSON.stringify({ id: invoice, order_id: id, number: `INV-${randomUUID()}` })])
      return { ...f, order_id: id, invoice, input: { ...f.input, order_id: id } } as F
    }
    it('two settlements of one customer that both keep a card are serialized: both orders settle, one default card remains and the other card\'s token is queued for deletion', async () => {
      const f = await order()
      const g = await secondOrder(f)
      const [sf, sg] = [await form(f, saving), await form(g, saving)]
      const [pf, pg] = [fulfil(f, sf, { saveCard: true }), fulfil(f, sg, { saveCard: true })]
      await Promise.all([webhook(f, pf.payment_id), webhook(f, pg.payment_id)])
      for (const x of [f, g]) expect(await orderRow(x)).toMatchObject({ payment_state: 'paid' })
      const rows = await methods(f)
      expect(rows.filter(r => r.status === 'active' && r.is_default)).toHaveLength(1)
      expect(rows.filter(r => r.status === 'removed')).toHaveLength(1)
      const removedToken = [pf.token, pg.token].find(t => t !== rows.find(r => r.status === 'active').provider_token)!
      await expect(f.adapter.getToken(removedToken)).rejects.toMatchObject({ code: 'not_found' })
      expect((await pool.query("SELECT status FROM commercial_outbox WHERE kind='payment_token.delete'")).rows).toEqual([{ status: 'done' }])
      expect((await subscription(f)).auto_renew_enabled).toBe(true)
    })
    it('a card that cannot be saved (any constraint) rolls back only the card: the payment settles, the old default stays, the new token is deleted', async () => {
      const f = await order()
      await seedPaymentMethod(pool, f.customer, 'sim_old_token')
      f.adapter.addToken('sim_old_token')
      vi.spyOn(console, 'error').mockImplementation(() => {})
      const s = await form(f, saving)
      const p = fulfil(f, s, { saveCard: true })
      await pool.query("ALTER TABLE payment_methods ADD CONSTRAINT test_no_visa CHECK (brand <> 'visa') NOT VALID")
      try { await webhook(f, p.payment_id) } finally { await pool.query('ALTER TABLE payment_methods DROP CONSTRAINT test_no_visa') }
      expect(await orderRow(f)).toMatchObject({ payment_state: 'paid' })
      expect((await methods(f)).map(r => [r.provider_token, r.status, r.is_default])).toEqual([['sim_old_token', 'active', true]])
      expect((await subscription(f)).auto_renew_enabled).toBe(false)
      expect((await audits('payment.card_not_saved', f.order_id))[0].metadata).toMatchObject({ reason: 'card_save_failed' })
      await expect(f.adapter.getToken(p.token!)).rejects.toMatchObject({ code: 'not_found' })
      await expect(f.adapter.getToken('sim_old_token')).resolves.toMatchObject({ active: true })
    })
    it('a token the provider will not delete is given up after twelve tries: the row fails without the token, the removed card forgets it, and the vendor sees the card', async () => {
      const f = await order()
      await seedPaymentMethod(pool, f.customer, 'sim_old_token')
      f.adapter.addToken('sim_old_token')
      vi.spyOn(f.adapter, 'deleteToken').mockRejectedValue(Object.assign(new Error('down'), { code: 'provider_unreachable' }))
      vi.spyOn(console, 'error').mockImplementation(() => {})
      const s = await form(f, saving)
      await webhook(f, fulfil(f, s, { saveCard: true }).payment_id)
      await pool.query("UPDATE commercial_outbox SET attempts=11,next_attempt_at=now() WHERE kind='payment_token.delete'")
      await processTokenDeletions(pool, f.adapter)
      const row = (await pool.query("SELECT * FROM commercial_outbox WHERE kind='payment_token.delete'")).rows[0]
      expect(row.status).toBe('failed')
      expect(JSON.stringify(row.payload)).not.toContain('sim_old_token')
      expect(row.payload).toMatchObject({ error: 'provider_unreachable', card: { brand: 'visa', last_four: '4242' } })
      expect((await methods(f)).find(r => r.status === 'removed').provider_token).toBeNull()
      const item = (await attention(pool, true)).items.find(i => i.kind === 'form_payment_review' && i.customer_id === f.customer)
      expect(item?.detail).toBe('token_not_deleted: visa 4242')
      await pool.query("UPDATE commercial_outbox SET created_at=now()-interval '2 days' WHERE kind='payment_token.delete'")
    })
    it('a token deletion older than a day is given up at its next failure', async () => {
      const f = await order()
      vi.spyOn(f.adapter, 'deleteToken').mockRejectedValue(Object.assign(new Error('down'), { code: 'timeout' }))
      vi.spyOn(console, 'error').mockImplementation(() => {})
      const s = await form(f)
      await webhook(f, fulfil(f, s, { saveCard: true }).payment_id) // the row said no card: the token is queued for deletion
      await pool.query("UPDATE commercial_outbox SET created_at=now()-interval '2 days',next_attempt_at=now() WHERE kind='payment_token.delete'")
      await processTokenDeletions(pool, f.adapter)
      expect((await pool.query("SELECT status,payload FROM commercial_outbox WHERE kind='payment_token.delete'")).rows[0]).toMatchObject({ status: 'failed', payload: { error: 'timeout' } })
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

  describe('a card form used with no payment ever reported, and a return host that changed', () => {
    it('at the end of its lifetime a fulfilled intent with no reported payment is closed for review, not silently: audit, attention item, and the late callback still settles', async () => {
      const f = await order()
      const s = await form(f)
      const p = fulfil(f, s) // money may have been taken; no webhook, no return
      await pool.query("UPDATE payment_attempts SET created_at=now()-interval '56 minutes',updated_at=now()-interval '1 hour' WHERE id=$1", [s.attempt_id])
      await reconcileUnknownAttempts(pool, f.adapter)
      expect(await attemptRow(s.attempt_id)).toMatchObject({ status: 'canceled', provider_ref: null })
      expect(await audits('payment.form_attempt_needs_review', f.order_id)).toHaveLength(1)
      expect((await f.adapter.getIntent(s.intent.id)).status).toBe('fulfilled') // not cancelled: nothing is thrown away
      const item = (await attention(pool, true)).items.find(i => i.kind === 'form_payment_review' && i.customer_id === f.customer)
      expect(item).toMatchObject({ detail: 'attempt_needs_review' })
      await reconcileUnknownAttempts(pool, f.adapter)
      expect(await audits('payment.form_attempt_needs_review', f.order_id)).toHaveLength(1)
      // The payer's late return for the closed attempt is still looked at.
      expect(await hint(f, s.attempt_id, p.payment_id)).toMatchObject({ payment_state: 'paid' })
      expect(await attemptRow(s.attempt_id)).toMatchObject({ status: 'succeeded', provider_ref: p.payment_id })
    })
    it('a paid payment that could not be tied to its attempt shows on the vendor list with no customer; a payer typing a bad hint does not', async () => {
      const f = await order()
      const s = await form(f)
      await hint(f, s.attempt_id, 'bad hint!')
      expect((await attention(pool, true)).items.filter(i => i.kind === 'form_payment_review')).toEqual([])
      const forged = forge(s, f, { amount: sar(100) })
      await hint(f, s.attempt_id, forged.payment_id)
      expect((await attention(pool, true)).items.filter(i => i.kind === 'form_payment_review')).toEqual([])
      await webhook(f, forged.payment_id) // the provider itself reports it: nobody is shown to have made it, so no customer carries it
      expect((await attention(pool, true)).items.find(i => i.kind === 'form_payment_review' && i.detail === 'amount_mismatch')).toMatchObject({ customer_id: null, name: 'payment provider' })
    })
    it('after a decline the customer may switch to a hosted invoice at once', async () => {
      const f = await order()
      const s = await form(f)
      await hint(f, s.attempt_id, fulfil(f, s, { card: { outcome: 'declined', message: 'DECLINED' } }).payment_id)
      expect((await createPaymentAttempt(pool, f.input)).kind).toBe('hosted_invoice')
      expect(await attemptRow(s.attempt_id)).toMatchObject({ status: 'canceled' })
    })
    it('a payment is judged against the intent\'s own locked callback, so a changed return origin does not break a form that is open', async () => {
      const f = await order()
      const s = await form(f)
      f.input.returnOrigin = fixedReturnOrigin('https://acme.liwan.test') // the customer now has a tenant host; the form opened under the prospect host
      expect((await form(f)).intent.id).toBe(s.intent.id)
      expect((await f.adapter.getIntent(s.intent.id)).callback_url).toContain('https://liwan.test/')
      expect(await hint(f, s.attempt_id, fulfil(f, s).payment_id)).toMatchObject({ payment_state: 'paid' })
    })
    it('a new intent after the origin changed returns to the new origin, and its payment settles', async () => {
      const f = await order()
      const s = await form(f)
      await hint(f, s.attempt_id, fulfil(f, s, { card: { outcome: 'declined', message: 'DECLINED' } }).payment_id)
      f.input.returnOrigin = fixedReturnOrigin('https://acme.liwan.test')
      const next = await form(f)
      expect((await f.adapter.getIntent(next.intent.id)).callback_url).toContain('https://acme.liwan.test/api/commercial/payment-callback?attempt=')
      expect(await hint(f, next.attempt_id, fulfil(f, next).payment_id)).toMatchObject({ payment_state: 'paid' })
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
  describe('review hardening of the form payment path', () => {
    const reviewItems = async () => (await allAttentionItems(pool)).filter(i => i.kind === 'form_payment_review')
    const settleNothing = async () => 'rejected' as const

    describe('the rejection budget never gates money', () => {
      it('500 unrelated rejected events do not stop a genuine payment for another order, and a money-relevant rejection for another order is still audited', async () => {
        const noise = await order()
        const sn = await form(noise)
        for (let i = 0; i < 500; i++) {
          const stranger = noise.adapter.directPayment({ status: 'succeeded', amount: sar(100 + i), description: buildAttemptDescription(randomUUID()), callback_url: 'https://elsewhere.test/cb' })
          await handleProviderEvent(pool, { provider: 'simulator', adapter: noise.adapter, rawBody: noise.adapter.paymentWebhookBody(stranger.payment_id), headers: {} })
        }
        // The unattributed budget is spent and says so once; the rejections that were written are bounded.
        expect((await audits('payment.form_payment_rejected')).length).toBeLessThanOrEqual(20)
        expect(await audits(REJECTION_SUPPRESSED_ACTION)).toHaveLength(1)
        // A genuine payment of another order settles on its first webhook, with the same adapter reading it.
        const b = await order(true, noise.adapter)
        const sb = await form(b)
        const genuine = fulfil(b, sb)
        expect(await webhook(b, genuine.payment_id)).toEqual({ status: 200, outcome: 'accepted' })
        expect(await orderRow(b)).toMatchObject({ payment_state: 'paid' })
        // A money-relevant rejection naming a third order is audited for that order although the unattributed budget is spent.
        const c = await order(true, noise.adapter)
        const sc = await form(c)
        const wrong = forge(sc, c, { amount: sar(100) })
        expect(await webhook(c, wrong.payment_id)).toEqual({ status: 409, outcome: 'unmatched' })
        expect((await audits('payment.form_payment_rejected', c.order_id)).map(r => r.metadata.reason)).toEqual(['amount_mismatch'])
        void sn
      })
      it('raises one vendor alert when an audit write was suppressed, naming the order and no customer', async () => {
        const f = await order()
        const s = await form(f)
        for (let i = 0; i < 25; i++) await webhook(f, forge(s, f, { amount: sar(100 + i) }).payment_id)
        expect(await audits('payment.form_payment_rejected', f.order_id)).toHaveLength(20)
        const suppressed = await audits(REJECTION_SUPPRESSED_ACTION, f.order_id)
        expect(suppressed).toHaveLength(1)
        const sent: { subject: string; text: string }[] = []
        await sendVendorAlerts(pool, { now: new Date(), env: { LIWAN_VENDOR_ALERT_EMAIL_TO: 'owner@example.test' }, mail: { send: async (m: any) => { sent.push(m); return { accepted: true, provider_message_id: 'p' } } } as any })
        const alert = sent.filter(m => m.subject.includes('سجل رفض دفعات البطاقة'))
        expect(alert).toHaveLength(1)
        expect(alert[0]!.text).toContain(f.order_id.slice(0, 8))
        expect(alert[0]!.text).not.toContain('العميل:')
      })
      it('a transient reason is never budgeted, and a trivial one cannot use up the money budget', async () => {
        const f = await order()
        const s = await form(f)
        for (let i = 0; i < 30; i++) await hint(f, s.attempt_id, `bad hint ${i}!`)
        expect((await audits('payment.form_hint_rejected')).filter(r => r.metadata.reason === 'bad_shape').length).toBeGreaterThan(0)
        await hint(f, s.attempt_id, forge(s, f, { amount: sar(100) }).payment_id)
        expect((await audits('payment.form_hint_rejected', f.order_id)).map(r => r.metadata.reason)).toContain('amount_mismatch')
      })
    })

    describe('transient reasons are answered, never written', () => {
      it('an early webhook (the intent does not read as fulfilled yet) writes nothing, raises nothing and is not remembered; the retry settles', async () => {
        const f = await order()
        const s = await form(f)
        const p = fulfil(f, s)
        const real = await f.adapter.getIntent(s.intent.id)
        vi.spyOn(f.adapter, 'getIntent').mockResolvedValueOnce({ ...real, status: 'created' })
        expect(await webhook(f, p.payment_id)).toEqual({ status: 409, outcome: 'unmatched' })
        expect(await audits('payment.form_payment_rejected')).toEqual([])
        expect(await reviewItems()).toEqual([])
        expect(await webhook(f, p.payment_id)).toEqual({ status: 200, outcome: 'accepted' })
        expect(await orderRow(f)).toMatchObject({ payment_state: 'paid' })
        expect(await fulfilments(f)).toBe(1)
      })
      it('a permanent rejection is remembered for a few minutes: the provider is not asked again', async () => {
        const f = await order()
        const s = await form(f)
        const forged = forge(s, f, { amount: sar(100) })
        const read = vi.spyOn(f.adapter, 'readPayment')
        await webhook(f, forged.payment_id)
        await webhook(f, forged.payment_id)
        expect(read).toHaveBeenCalledTimes(1)
      })
    })

    describe('the binding and the settlement are one', () => {
      it('a settlement the machine refuses leaves the payment bound to nothing', async () => {
        const f = await order()
        const s = await form(f)
        const p = fulfil(f, s)
        const refused = await resolveFormPayment(pool, f.adapter, { payment_id: p.payment_id, source: 'webhook', settle: settleNothing })
        expect(refused).toEqual({ outcome: 'rejected', reason: 'settlement_mismatch' })
        expect(await attemptRow(s.attempt_id)).toMatchObject({ provider_ref: null, status: 'pending' })
        expect(await orderRow(f)).toMatchObject({ payment_state: 'awaiting_payment' })
        // The payment is still free to settle the way it should (once the short memory of its rejection has passed).
        await pool.query("DELETE FROM audit_events WHERE action LIKE 'payment.form%'")
        expect(await webhook(f, p.payment_id)).toEqual({ status: 200, outcome: 'accepted' })
        expect(await attemptRow(s.attempt_id)).toMatchObject({ provider_ref: p.payment_id, status: 'succeeded' })
      })
    })

    describe('a forged failed payment', () => {
      it('without the secret leaves no decline mark, and does not open a fresh intent for the victim', async () => {
        const f = await order()
        const s = await form(f)
        const before = await attemptRow(s.attempt_id)
        consumeIntent(f, s)
        const forgedFail = forge(s, f, { status: 'failed' })
        await hint(f, s.attempt_id, forgedFail.payment_id)
        await webhook(f, forgedFail.payment_id)
        expect(await attemptRow(s.attempt_id)).toMatchObject({ declined_payment_ref: null, provider_ref: null })
        expect(before.declined_payment_ref).toBeNull()
        expect(await audits('payment.form_declined', f.order_id)).toEqual([])
      })
    })

    describe('who a form is for', () => {
      it('records the person the form was opened for and keeps that person as the creator of the saved card', async () => {
        const f = await order()
        const s = await form(f, saving, '42')
        expect(await attemptRow(s.attempt_id)).toMatchObject({ opened_by: '42', save_card: true })
        await webhook(f, fulfil(f, s, { saveCard: true }).payment_id)
        expect((await methods(f)).map(m => m.created_by)).toEqual(['42'])
      })
      it('the same person may change the choice while the intent is unused, and not once it is fulfilled', async () => {
        const f = await order()
        const s = await form(f, {}, '42')
        await form(f, saving, '42')
        expect(await attemptRow(s.attempt_id)).toMatchObject({ save_card: true, opened_by: '42' })
        fulfil(f, s)
        await expect(form(f, {}, '42')).rejects.toMatchObject({ status: 409, code: 'payment_in_progress' })
        expect(await attemptRow(s.attempt_id)).toMatchObject({ save_card: true, consent_text_version: CURRENT_CONSENT_TEXT_VERSION })
      })
      it('another person is never handed a live client secret: the unused intent is cancelled and they get a fresh one with their own choice', async () => {
        const f = await order()
        const mine = await form(f, saving, '42')
        const theirs = await form(f, {}, '43')
        expect(theirs.attempt_id).toBe(mine.attempt_id)
        expect(theirs.intent.id).not.toBe(mine.intent.id)
        expect(theirs.intent.client_secret).not.toBe(mine.intent.client_secret)
        expect((await f.adapter.getIntent(mine.intent.id)).status).toBe('canceled')
        expect(() => fulfil(f, mine)).toThrow()
        expect(await attemptRow(theirs.attempt_id)).toMatchObject({ opened_by: '43', save_card: false, consent_at: null, consent_text_version: null, provider_intent_ref: theirs.intent.id })
        // And the first person is now the stranger: the same rule applies to them.
        const back = await form(f, saving, '42')
        expect(back.intent.id).not.toBe(theirs.intent.id)
        expect(await attemptRow(theirs.attempt_id)).toMatchObject({ opened_by: '42', save_card: true })
      })
      it('another person gets nothing while the intent may hold a payment', async () => {
        const f = await order()
        const s = await form(f, {}, '42')
        fulfil(f, s)
        await expect(form(f, {}, '43')).rejects.toMatchObject({ status: 409, code: 'payment_in_progress' })
        expect(await attemptRow(s.attempt_id)).toMatchObject({ opened_by: '42' })
        expect((await f.adapter.getIntent(s.intent.id)).status).toBe('fulfilled')
      })
    })

    describe('an expired intent holds no payment', () => {
      it('is replaced at once, with no payment in progress', async () => {
        const f = await order()
        const s = await form(f)
        f.adapter.expireIntent(s.intent.id)
        expect((await f.adapter.getIntent(s.intent.id)).status).toBe('expired')
        const next = await form(f)
        expect(next.attempt_id).toBe(s.attempt_id)
        expect(next.intent.id).not.toBe(s.intent.id)
      })
      it('closing an attempt whose intent expired unused asks for no review', async () => {
        const f = await order()
        const s = await form(f)
        f.adapter.expireIntent(s.intent.id)
        await pool.query("UPDATE payment_attempts SET created_at=now()-interval '56 minutes' WHERE id=$1", [s.attempt_id])
        const next = await form(f)
        expect(next.attempt_id).not.toBe(s.attempt_id)
        expect(await attemptRow(s.attempt_id)).toMatchObject({ status: 'canceled' })
        expect(await audits('payment.form_attempt_needs_review', f.order_id)).toEqual([])
      })
    })

    describe('what the operator is shown', () => {
      const backdate = () => pool.query("UPDATE audit_events SET created_at=created_at-interval '30 days' WHERE action LIKE 'payment.form%'")
      it('keeps a paid payment of this customer\'s own attempt until it is settled or refunded, however old', async () => {
        const f = await order()
        const s = await form(f)
        await hint(f, s.attempt_id, fulfil(f, s).payment_id)
        const again = forge(s, f, { callback_url: (await f.adapter.getIntent(s.intent.id)).callback_url })
        await webhook(f, again.payment_id)
        expect((await audits('payment.form_payment_rejected', f.order_id)).map(r => r.metadata.reason)).toEqual(['attempt_has_other_payment'])
        await backdate()
        expect((await reviewItems()).filter(i => i.customer_id === f.customer)).toEqual([expect.objectContaining({ detail: 'attempt_has_other_payment' })])
        await f.adapter.refund(again.payment_id)
        await webhook(f, again.payment_id)
        expect((await reviewItems()).filter(i => i.customer_id === f.customer)).toEqual([])
      })
      it('does not attach a payment that never held the secret to the customer: it is a provider item until refunded', async () => {
        const f = await order()
        const s = await form(f)
        consumeIntent(f, s)
        const attack = forge(s, f) // right description and amount, the public callback, no secret
        await webhook(f, attack.payment_id)
        await backdate()
        const items = await reviewItems()
        expect(items.filter(i => i.customer_id === f.customer)).toEqual([])
        expect(items.find(i => i.detail === 'callback_mismatch')).toMatchObject({ customer_id: null, name: 'payment provider' })
        await f.adapter.refund(attack.payment_id)
        await webhook(f, attack.payment_id)
        expect((await reviewItems()).find(i => i.detail === 'callback_mismatch')).toBeUndefined()
      })
      it('keeps an attempt used with no payment reported until its order is paid or cancelled, and clears it then', async () => {
        const f = await order()
        const s = await form(f)
        fulfil(f, s)
        await pool.query("UPDATE payment_attempts SET created_at=now()-interval '56 minutes' WHERE id=$1", [s.attempt_id])
        await form(f).catch(() => undefined)
        expect(await audits('payment.form_attempt_needs_review', f.order_id)).toHaveLength(1)
        await backdate()
        expect((await reviewItems()).filter(i => i.customer_id === f.customer)).toEqual([expect.objectContaining({ detail: 'attempt_needs_review' })])
        await pool.query("UPDATE orders SET cancelled=true WHERE id=$1", [f.order_id])
        expect((await reviewItems()).filter(i => i.customer_id === f.customer)).toEqual([])
      })
    })

    describe('a card kept only where renewal can charge it', () => {
      it.each([['an armed free-base lock','lock'],['a confirmed workspace deletion','deletion']])('saves the card but leaves auto-renew off during %s, and says why', async (_name, kind) => {
        const f = await order()
        const sub = await subscription(f)
        if (kind === 'lock') await pool.query(`INSERT INTO free_base_locks(subscription_id,pre_lock_revision_id,period_start,armed_at,trial_ended_at,cause,next_attempt_at)
          SELECT id,target_revision_id,'2026-10-01',now(),NULL,'refund',now() FROM subscriptions WHERE id=$1`, [sub.id])
        else await pool.query(`INSERT INTO tenant_deletion_requests(id,customer_id,state,requested_at,requested_by,confirmed_at,confirmed_by,due_at,renewal_outcome) VALUES($1,$2,'confirmed',now(),'7',now(),'7',now()+interval '30 days','cancelled')`, [randomUUID(), f.customer])
        const s = await form(f, saving)
        await webhook(f, fulfil(f, s, { saveCard: true }).payment_id)
        expect((await methods(f)).map(m => [m.status, m.is_default])).toEqual([['active', true]])
        expect((await subscription(f)).auto_renew_enabled).toBe(false)
        expect((await audits('auto_renew.not_enabled', f.subscription)).map(a => a.metadata.reason)).toEqual([kind === 'lock' ? 'free_base_lock' : 'workspace_deletion'])
      })
    })

    describe('one lock order', () => {
      it('removing the default card while a payment saves another neither deadlocks nor loses a payment', async () => {
        for (let round = 0; round < 12; round++) {
          const f = await order()
          const old = await seedPaymentMethod(pool, f.customer, `sim_old_${round}`)
          f.adapter.addToken(`sim_old_${round}`)
          const s = await form(f, saving)
          const p = fulfil(f, s, { saveCard: true })
          const results = await Promise.allSettled([webhook(f, p.payment_id), removePaymentMethod(pool, f.adapter, { by: 'customer', actor: '7', reason: null, customer_id: f.customer, payment_method_id: old })])
          for (const r of results) if (r.status === 'rejected') expect((r.reason as { code?: string }).code).not.toBe('40P01')
          expect(await orderRow(f)).toMatchObject({ payment_state: 'paid' })
          const rows = await methods(f)
          expect(rows.filter(m => m.status === 'active' && m.is_default)).toHaveLength(1)
          expect(rows.find(m => m.id === old)).toMatchObject({ status: 'removed' })
        }
      })

      it('a cancellation racing a card-saving settlement neither deadlocks nor loses money', async () => {
        for (let round = 0; round < 12; round++) {
          const f = await order()
          const s = await form(f, saving)
          const p = fulfil(f, s, { saveCard: true })
          const principal = { actor_id: '7', kind: 'vendor', customer_id: null, tenant_id: null, capabilities: ['vendor.subscriptions.manage'] } as any
          const results = await Promise.allSettled([webhook(f, p.payment_id), cancelOrder(pool, { order_id: f.order_id, principal, reason: 'Cancelled while paying', adapter: f.adapter })])
          for (const r of results) if (r.status === 'rejected') expect((r.reason as { code?: string }).code).not.toBe('40P01')
          const o = await orderRow(f)
          // Paid (the cancel found it paid), or cancelled with the payment taken back to the refund path: never both unpaid and charged.
          expect(['paid', 'refund_pending', 'awaiting_payment']).toContain(o.payment_state)
          const settled = (await attemptRow(s.attempt_id)).provider_ref === p.payment_id
          if (o.payment_state === 'awaiting_payment') {
            // The cancellation won and the payment is not yet settled: a later webhook turns it into a refund, never a lost payment.
            expect(o.cancelled).toBe(true)
            expect(await webhook(f, p.payment_id)).toMatchObject({ status: 200 })
            expect((await orderRow(f)).payment_state).toBe('refund_pending')
          } else expect(settled).toBe(true)
          if (o.payment_state === 'refund_pending' || (await orderRow(f)).payment_state === 'refund_pending') expect(await methods(f)).toEqual([])
        }
      })
    })
  })
  describe('finding a payment that never reported back', () => {
    const OLD = "created_at=now()-interval '56 minutes',updated_at=now()-interval '1 hour'"
    const AGED = "created_at=now()-interval '20 minutes',updated_at=now()-interval '1 hour'"
    const age = (id: string, set: string) => pool.query(`UPDATE payment_attempts SET ${set} WHERE id=$1`, [id])
    const tagged = (s: FormPaymentSession) => ({ metadata: { attempt_id: s.attempt_id } })
    const reconcile = (f: F) => reconcileUnknownAttempts(pool, f.adapter)
    const searches = async (s: FormPaymentSession) => (await audits('payment.form_payment_searched', s.attempt_id)).length

    it('a paid payment found at the end of the lifetime settles without any operator action', async () => {
      const f = await order()
      const s = await form(f, saving)
      const p = fulfil(f, s, { ...tagged(s), saveCard: true }) // paid; the webhook and the return both never came
      await age(s.attempt_id, OLD)
      await reconcile(f)
      expect(await orderRow(f)).toMatchObject({ payment_state: 'paid', paid_attempt_id: s.attempt_id })
      expect(await attemptRow(s.attempt_id)).toMatchObject({ status: 'succeeded', provider_ref: p.payment_id })
      expect(await audits('payment.form_attempt_needs_review', f.order_id)).toEqual([])
      expect(await fulfilments(f)).toBe(1)
      expect(await methods(f)).toHaveLength(1)
      expect(await searches(s)).toBe(1)
    })
    it('a paid payment is also found by the reconciler while the attempt is still open, once the provider has had its 15 minutes', async () => {
      const f = await order()
      const s = await form(f)
      const p = fulfil(f, s, tagged(s))
      await age(s.attempt_id, "created_at=now()-interval '10 minutes',updated_at=now()-interval '1 hour'")
      await reconcile(f)
      expect(f.adapter.searches).toBe(0) // too early: a payment still being authenticated would only be found in progress
      await age(s.attempt_id, AGED)
      await reconcile(f)
      expect(await attemptRow(s.attempt_id)).toMatchObject({ status: 'succeeded', provider_ref: p.payment_id })
      expect(await orderRow(f)).toMatchObject({ payment_state: 'paid' })
    })
    it('a failed payment that is found records the decline: the customer starts again at once and no review item ever appears', async () => {
      const f = await order()
      const s = await form(f)
      const p = fulfil(f, s, { ...tagged(s), card: { outcome: 'declined', message: 'INSUFFICIENT FUNDS' } })
      await age(s.attempt_id, AGED)
      await reconcile(f)
      expect(await attemptRow(s.attempt_id)).toMatchObject({ status: 'pending', provider_ref: null, declined_payment_ref: p.payment_id })
      expect(await audits('payment.form_declined', f.order_id)).toHaveLength(1)
      const next = await form(f)
      expect(next.attempt_id).toBe(s.attempt_id)
      expect(next.intent.id).not.toBe(s.intent.id)
      // The same finding at the end of the lifetime asks for no review either.
      const g = await order()
      const t = await form(g)
      fulfil(g, t, { ...tagged(t), card: { outcome: 'declined', message: 'DECLINED' } })
      await age(t.attempt_id, OLD)
      await reconcile(g)
      expect(await attemptRow(t.attempt_id)).toMatchObject({ status: 'canceled' })
      expect(await audits('payment.form_attempt_needs_review', g.order_id)).toEqual([])
      expect((await attention(pool, true)).items.filter(i => i.kind === 'form_payment_review')).toEqual([])
      expect((await pool.query('SELECT payment_hold_until FROM payment_attempts WHERE id=$1', [t.attempt_id])).rows[0].payment_hold_until).toBeNull()
    })
    it('a forged payment that carries the victim\'s attempt id in its metadata is found, rejected, and changes nothing', async () => {
      const f = await order()
      const s = await form(f)
      fulfil(f, s, { card: { outcome: 'needs_customer_action' } }) // the victim is mid-authentication: the intent is fulfilled, the payment is not paid
      const forged = forge(s, f) // paid, the locked description and the plain callback, but not the intent's secret
      f.adapter.tagPayment(forged.payment_id, s.attempt_id)
      await age(s.attempt_id, OLD)
      await reconcile(f)
      expect(await orderRow(f)).toMatchObject({ payment_state: 'awaiting_payment', paid_attempt_id: null })
      expect(await attemptRow(s.attempt_id)).toMatchObject({ provider_ref: null, declined_payment_ref: null, status: 'canceled' })
      expect(await audits('payment.form_search_rejected', f.order_id)).toEqual([expect.objectContaining({ metadata: expect.objectContaining({ reason: 'callback_mismatch', payment_id: forged.payment_id }) })])
      expect(await fulfilments(f)).toBe(0)
      // What no search can verify keeps today's behaviour: the vendor is asked to look.
      expect(await audits('payment.form_attempt_needs_review', f.order_id)).toHaveLength(1)
    })
    it('a forged payment is not settled by an attempt whose id it merely names, even when its callback is copied from a real one', async () => {
      const f = await order()
      const s = await form(f)
      const real = fulfil(f, s, { card: { outcome: 'needs_customer_action' } })
      const copied = forge(s, f, { callback_url: (await f.adapter.getIntent(s.intent.id)).callback_url, description: null })
      f.adapter.tagPayment(copied.payment_id, s.attempt_id)
      await age(s.attempt_id, AGED)
      await reconcile(f)
      expect(await attemptRow(s.attempt_id)).toMatchObject({ provider_ref: null, status: 'pending' })
      expect(await orderRow(f)).toMatchObject({ payment_state: 'awaiting_payment' })
      expect(real.payment_id).not.toBe(copied.payment_id)
    })
    it('nothing found keeps the review item and the hold', async () => {
      const f = await order()
      const s = await form(f)
      fulfil(f, s) // paid, but nobody tagged it (a page from before the tag, say)
      await age(s.attempt_id, OLD)
      await reconcile(f)
      expect(await attemptRow(s.attempt_id)).toMatchObject({ status: 'canceled', provider_ref: null })
      expect(await audits('payment.form_attempt_needs_review', f.order_id)).toHaveLength(1)
      expect((await attemptRow(s.attempt_id)).payment_hold_until).toBeInstanceOf(Date)
      expect(await searches(s)).toBe(1)
    })
    it('is bounded: never in a request, once per run, spaced out, at most four per attempt, and a provider failure costs a turn but changes nothing', async () => {
      const f = await order()
      const s = await form(f)
      fulfil(f, s, { card: { outcome: 'needs_customer_action' } })
      // A customer's return or request never searches.
      await age(s.attempt_id, "created_at=now()-interval '30 minutes',updated_at=now()-interval '1 minute'")
      await verifyReturnedAttempt(pool, { attempt_id: s.attempt_id, customer_id: f.customer, adapter: f.adapter })
      await form(f).catch(() => {})
      expect(f.adapter.searches).toBe(0)
      // The reconciler searches once per run, and not again within the gap.
      await age(s.attempt_id, AGED)
      await reconcile(f)
      await age(s.attempt_id, AGED)
      await reconcile(f)
      expect(f.adapter.searches).toBe(1)
      // After the gap it may; at most four searches in all, the one at the end of the lifetime ignoring the gap.
      const spaced = () => pool.query("UPDATE audit_events SET created_at=now()-interval '20 minutes' WHERE action='payment.form_payment_searched' AND subject=$1", [s.attempt_id])
      for (let run = 0; run < 2; run++) { await spaced(); await age(s.attempt_id, AGED); await reconcile(f) }
      expect(f.adapter.searches).toBe(3)
      await age(s.attempt_id, OLD)
      await reconcile(f)
      expect(f.adapter.searches).toBe(4)
      expect(await searches(s)).toBe(4)
      // Nothing more, whatever the age or the gap.
      await spaced()
      await age(s.attempt_id, OLD)
      await pool.query("UPDATE payment_attempts SET status='pending' WHERE id=$1", [s.attempt_id])
      await reconcile(f)
      expect(f.adapter.searches).toBe(4)
      // A provider error ends the turn without changing the attempt.
      const g = await order()
      const t = await form(g)
      fulfil(g, t, { card: { outcome: 'needs_customer_action' } })
      vi.spyOn(g.adapter, 'listPaymentsByAttempt').mockRejectedValue(new PaymentError('provider_unreachable'))
      vi.spyOn(console, 'error').mockImplementation(() => {})
      await age(t.attempt_id, AGED)
      await reconcile(g)
      expect(await attemptRow(t.attempt_id)).toMatchObject({ status: 'pending', provider_ref: null, declined_payment_ref: null })
      expect(await searches(t)).toBe(1)
    })
  })

  describe('an abandoned payment', () => {
    const abandonedWebhook = (f: F, paymentId: string, status: 'pending' | 'failed' = 'pending') =>
      handleProviderEvent(pool, { provider: 'simulator', adapter: f.adapter, rawBody: f.adapter.paymentWebhookBody(paymentId, { status, type: 'payment_abandoned' }), headers: {} })

    it('a payment_abandoned event records the decline: the customer may start again at once instead of waiting out the lifetime', async () => {
      const f = await order()
      const s = await form(f)
      const p = fulfil(f, s, { card: { outcome: 'needs_customer_action' } }) // the payer left the 3-D Secure page
      await expect(form(f)).rejects.toMatchObject({ status: 409, code: 'payment_in_progress' })
      expect(await abandonedWebhook(f, p.payment_id)).toEqual({ status: 200, outcome: 'ignored' })
      expect(await attemptRow(s.attempt_id)).toMatchObject({ declined_payment_ref: p.payment_id, provider_ref: null })
      expect(await audits('payment.form_declined', f.order_id)).toEqual([expect.objectContaining({ metadata: expect.objectContaining({ cause: 'abandoned' }) })])
      const next = await form(f)
      expect(next.attempt_id).toBe(s.attempt_id)
      expect(next.intent.id).not.toBe(s.intent.id)
      expect(await orderRow(f)).toMatchObject({ payment_state: 'awaiting_payment' })
    })
    it('a pending payment is not a decline without the event, and the event cannot decline a payment that is not this attempt\'s', async () => {
      const f = await order()
      const s = await form(f)
      const p = fulfil(f, s, { card: { outcome: 'needs_customer_action' } })
      expect(await webhook(f, p.payment_id)).toEqual({ status: 200, outcome: 'ignored' })
      expect(await attemptRow(s.attempt_id)).toMatchObject({ declined_payment_ref: null })
      const forged = forge(s, f, { status: 'pending' })
      expect(await abandonedWebhook(f, forged.payment_id)).toEqual({ status: 200, outcome: 'ignored' })
      expect(await attemptRow(s.attempt_id)).toMatchObject({ declined_payment_ref: null })
      await expect(form(f)).rejects.toMatchObject({ code: 'payment_in_progress' })
    })
    it('a payment that failed with the session-expired message is a decline, as any failed payment of the attempt is', async () => {
      const f = await order()
      const s = await form(f)
      const p = fulfil(f, s, { card: { outcome: 'needs_customer_action' } })
      f.adapter.setPaymentStatus(p.payment_id, 'failed', '3DS: The authentication session has expired')
      expect(await hint(f, s.attempt_id, p.payment_id)).toMatchObject({ payment_state: 'awaiting_payment' })
      expect(await attemptRow(s.attempt_id)).toMatchObject({ declined_payment_ref: p.payment_id })
      expect((await form(f)).intent.id).not.toBe(s.intent.id)
    })
  })
})
