import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { Pool } from 'pg'
import { signServiceRequest } from '@liwan/commercial-contracts/server'
import type { Principal } from '@liwan/commercial-contracts'
import { createApp } from '../http.js'
import { client, money, monthly, setup, url } from './commercial-helpers.js'
import { convertTrial, startTrial } from '../commercial/trial.js'
import { applyConfirmedEvent, createPaymentAttempt, verifyReturnedAttempt } from '../commercial/payments.js'
import { applyDunning, generateRenewals } from '../commercial/renewals.js'
import { sendRenewalNotices } from '../commercial/renewal-notices.js'
import { getSubscription } from '../commercial/subscriptions.js'
import { SimulatorAdapter } from '../commercial/payment-simulator.js'
import { fixedReturnOrigin } from '../commercial/return-origin.js'
import { RENEWAL_NOTICE_DAYS } from '../commercial/notice-timings.js'
import { owesAtRenewal } from '../commercial/free-base.js'
import type { PaymentAdapter } from '../commercial/payment-adapter.js'

const suite = url ? describe : describe.skip
suite('automatic renewal on a stored payment method (issue 492)', () => {
  const pool = new Pool({ connectionString: url, max: 8 })
  const api = client(pool)
  const reason = 'Auto renew acceptance'
  const now = new Date('2026-11-20T09:00:00Z')
  const origin = fixedReturnOrigin('https://liwan.test')
  const config = { installationId: 'auto-renew-test', key: 'vendor-test-key-'.repeat(4), customerCommercialIssuer: 'customer-auto-renew', customerCommercialServiceKey: 'customer-test-key-'.repeat(4),
    inventoryPath: '', repositoryRoot: '', python: 'python3', stateDir: '' }
  let plan: any, noRenewPlan: any, server: ReturnType<typeof createApp>, http: string
  const savedEnv = { provider: process.env.LIWAN_PAYMENT_PROVIDER, origins: process.env.LIWAN_PAYMENT_RETURN_ORIGINS }

  async function publishPlan(autoRenew: boolean) {
    const created = await api('POST', '/plans', { name: `Auto ${randomUUID()}`, audience: { kind: 'public' }, term_months: 12, currency: 'SAR',
      prices: [{ cadence: monthly, amount: money(30000) }], platform_limits: {}, included_bundle_revision_ids: [], optional_bundle_revision_ids: [],
      included_extra_branches: 0, extra_branch_prices: [{ cadence: monthly, amount: money(0) }], extra_branches_limit: null,
      included_users: 3, included_storage_mb: 5120, storage_step_mb: 10240, storage_step_threshold_mb: 102400, storage_large_step_mb: 102400,
      user_prices: [{ cadence: monthly, amount: money(0) }], storage_prices: [{ cadence: monthly, amount: money(0) }],
      policy_revision_id: '6f1c3d8e-0000-4000-8000-000000000001', trial_days: 14, grace_days: 7, auto_suspend: true, auto_renew_allowed: autoRenew })
    const validated = await api('POST', `/plans/${created.body.id}/validate`, { edit_revision: 1, reason })
    return (await api('POST', `/plans/${created.body.id}/publish`, { edit_revision: validated.body.edit_revision, reason })).body
  }
  beforeAll(async () => {
    const { version } = await setup(pool)
    await api('POST', '/catalog/releases', { catalog_version: version, reason })
    plan = await publishPlan(true)
    noRenewPlan = await publishPlan(false)
    process.env.LIWAN_PAYMENT_PROVIDER = 'simulator'; process.env.LIWAN_PAYMENT_RETURN_ORIGINS = 'https://liwan.test'
    server = createApp(pool, config).listen(0, '127.0.0.1')
    await new Promise<void>(resolve => server.once('listening', resolve))
    const address = server.address(); if (!address || typeof address === 'string') throw Error('missing address')
    http = `http://127.0.0.1:${address.port}`
  })
  afterAll(async () => {
    if (server) await new Promise<void>(resolve => server.close(() => resolve()))
    await pool.end()
    for (const [name, value] of [['LIWAN_PAYMENT_PROVIDER', savedEnv.provider], ['LIWAN_PAYMENT_RETURN_ORIGINS', savedEnv.origins]] as const) { if (value === undefined) delete process.env[name]; else process.env[name] = value }
  })

  /** A customer whose trial just converted: past_due with the first invoice and its hosted attempt. */
  async function converted(forPlan = plan) {
    const customer = randomUUID(), tenant = randomUUID()
    await pool.query("INSERT INTO tenants(id,name,commercial_mode,hosting_model,inventory_target,operations_enabled) VALUES($1,'Auto renew','saas','dedicated_managed',$2,true)", [tenant, `auto-${tenant}`])
    await pool.query('INSERT INTO customers(id,name,tenant_id,admin_login) VALUES($1,$2,$3,$4)', [customer, 'Auto renew', tenant, `${customer}@example.test`])
    const slug = `t${tenant.replaceAll('-', '')}`
    await pool.query('INSERT INTO shared_registry_bindings(control_tenant_id,tenant_id,host,database_name,filestore,enabled,registry_revision) VALUES($1,$2,$3,$4,$4,true,1)', [tenant, slug, `${slug}.test`, `liwan_scratch_${slug.slice(1)}`])
    const principal = { actor_id: '7', kind: 'customer', customer_id: customer, tenant_id: tenant, capabilities: ['subscription.manage'] } as unknown as Principal
    const request = { kind: 'new' as const, plan_revision_id: forPlan.id, bundle_revision_ids: [], cadence: monthly, requested_extra_branches: 0, requested_users: 3, requested_storage_mb: 5120 }
    await startTrial(pool, { customer_id: customer, request, principal, now: new Date(now.getTime() - 3 * 86_400_000) })
    await pool.query('UPDATE subscriptions SET applied_revision_id=target_revision_id,target_revision_id=NULL,revision=revision+1 WHERE customer_id=$1', [customer])
    await pool.query("UPDATE orders SET fulfillment_state='applied' WHERE customer_id=$1", [customer])
    const adapter = new SimulatorAdapter()
    const result = await convertTrial(pool, { customer_id: customer, now, adapter, returnOrigin: origin })
    const subscription = (await pool.query('SELECT * FROM subscriptions WHERE customer_id=$1', [customer])).rows[0]
    return { customer, tenant, adapter, order: result.order!, attempt: result.attempt!, subscription }
  }
  const sub = async (id: string) => (await pool.query('SELECT * FROM subscriptions WHERE id=$1', [id])).rows[0]
  const attemptRow = async (id: string) => (await pool.query('SELECT * FROM payment_attempts WHERE id=$1', [id])).rows[0]
  /** The customer pays the invoice on a fresh attempt that carries (or not) the consent, and the provider settles it. */
  async function payWithConsent(f: Awaited<ReturnType<typeof converted>>, save: boolean) {
    const view = await createPaymentAttempt(pool, { order_id: f.order.id, customer_id: f.customer, adapter: f.adapter, returnOrigin: origin, ...(save ? { save_payment_method: true } : {}) })
    const row = await attemptRow(view.id)
    const event = f.adapter.settle(row.provider_ref, 'succeeded')
    return { row, event }
  }

  it('stores the token only from a succeeded attempt that carried the consent, and never exposes it', async () => {
    const f = await converted()
    const old = f.attempt.id
    const { row, event } = await payWithConsent(f, true)
    // The hosted attempt the renewal opened on its own had no consent: it was replaced, not silently reused.
    expect(row.id).not.toBe(old)
    expect((await attemptRow(old)).status).toBe('canceled')
    expect(row).toMatchObject({ save_payment_method: true, save_payment_method_consent_at: expect.any(Date) })
    expect(event.payment_method_token).toMatch(/^sim_tok_/)
    expect((await applyConfirmedEvent(pool, event))).toBe('accepted')
    const stored = await sub(f.subscription.id)
    expect(stored).toMatchObject({ auto_renew_enabled: true, provider_token_ref: event.payment_method_token })
    expect(stored.auto_renew_consent_at.getTime()).toBe(row.save_payment_method_consent_at.getTime())
    // The token reaches no view, event row or audit record.
    const view = await getSubscription(pool, f.customer)
    expect(view.auto_renew).toMatchObject({ enabled: true, token_ref_present: true })
    expect(JSON.stringify(view)).not.toContain(event.payment_method_token)
    const everywhere = JSON.stringify([(await pool.query('SELECT * FROM audit_events')).rows, (await pool.query('SELECT * FROM payment_events')).rows, (await pool.query('SELECT * FROM commercial_outbox')).rows, (await pool.query('SELECT * FROM payment_attempts')).rows])
    expect(everywhere).not.toContain(event.payment_method_token)
  })

  it('is replay, out-of-order and concurrency safe: stored once, by the first accepted success', async () => {
    const f = await converted()
    const { event } = await payWithConsent(f, true)
    await Promise.all([1, 2, 3].map(() => applyConfirmedEvent(pool, event)))
    const afterFirst = await sub(f.subscription.id)
    await applyConfirmedEvent(pool, event)
    await applyConfirmedEvent(pool, { ...event, status: 'pending', event_id: 'late-pending', payment_method_token: undefined })
    const later = await sub(f.subscription.id)
    expect(later.revision).toBe(afterFirst.revision)
    expect(later.provider_token_ref).toBe(event.payment_method_token)
    expect((await pool.query("SELECT count(*)::int AS n FROM audit_events WHERE action='subscription.auto_renew_enabled' AND subject=$1", [f.subscription.id])).rows[0].n).toBe(1)
  })

  it('stores nothing for an attempt without consent, even if a token arrives', async () => {
    const f = await converted()
    const { event } = await payWithConsent(f, false)
    expect(event.payment_method_token).toBeUndefined()
    await applyConfirmedEvent(pool, { ...event, payment_method_token: 'sim_tok_deadbeef_9' })
    expect(await sub(f.subscription.id)).toMatchObject({ auto_renew_enabled: false, provider_token_ref: null })
  })

  it('refuses the consent where nothing can honour it: a plan that forbids it, an adapter that cannot store', async () => {
    const forbidden = await converted(noRenewPlan)
    await expect(createPaymentAttempt(pool, { order_id: forbidden.order.id, customer_id: forbidden.customer, adapter: forbidden.adapter, returnOrigin: origin, save_payment_method: true }))
      .rejects.toMatchObject({ status: 409, code: 'auto_renew_not_allowed' })
    const f = await converted()
    const noStorage = Object.create(f.adapter, { storesPaymentMethod: { value: false } }) as PaymentAdapter
    await expect(createPaymentAttempt(pool, { order_id: f.order.id, customer_id: f.customer, adapter: noStorage, returnOrigin: origin, save_payment_method: true }))
      .rejects.toMatchObject({ status: 409, code: 'payment_method_storage_unavailable' })
    expect((await attemptRow(f.attempt.id)).status).not.toBe('canceled')
  })

  /** An active subscription holding a stored token whose renewal is due, charged by an adapter in another process. */
  async function dueWithToken(token: string) {
    const f = await converted()
    const { event } = await payWithConsent(f, true)
    await applyConfirmedEvent(pool, event)
    await pool.query("UPDATE subscriptions SET state='active',renewal_at='2026-11-01',provider_token_ref=$2,revision=revision+1 WHERE id=$1", [f.subscription.id, token])
    return { ...f, token }
  }

  it('charges the stored token at renewal through an adapter that never saw the checkout (another process)', async () => {
    const f = await dueWithToken('sim_tok_0a0b0c0d_7')
    const worker = new SimulatorAdapter()
    const charge = vi.spyOn(worker, 'chargeToken')
    const generated = await generateRenewals(pool, { now, adapter: worker, returnOrigin: origin, subscription_id: f.subscription.id })
    expect(generated).toHaveLength(1)
    expect(charge).toHaveBeenCalledTimes(1)
    expect(charge.mock.calls[0]![0].token).toBe(f.token)
    const renewal = (await pool.query("SELECT a.id,a.token_charge FROM payment_attempts a JOIN orders o ON o.id=a.order_id WHERE o.subscription_id=$1 AND o.kind='renewal' ORDER BY a.created_at DESC LIMIT 1", [f.subscription.id])).rows[0]
    expect(renewal.token_charge).toBe(true)
    await pool.query("UPDATE payment_attempts SET updated_at=now()-interval '10 seconds' WHERE id=$1", [renewal.id])
    await verifyReturnedAttempt(pool, { attempt_id: renewal.id, customer_id: f.customer, adapter: worker })
    expect((await sub(f.subscription.id)).state).toBe('active')
    expect((await pool.query("SELECT payment_state FROM orders WHERE subscription_id=$1 AND kind='renewal'", [f.subscription.id])).rows[0].payment_state).toBe('paid')
    // A repeated run neither charges nor invoices again.
    await generateRenewals(pool, { now, adapter: worker, returnOrigin: origin, subscription_id: f.subscription.id })
    expect(charge).toHaveBeenCalledTimes(1)
  })

  it('follows the dunning path when the token no longer works: a hosted payment, then past_due, never a silent retry', async () => {
    const f = await dueWithToken('sim_tok_0a0b0c0d_8')
    const worker = new SimulatorAdapter().addToken('sim_tok_0a0b0c0d_8', 'revoked')
    const charge = vi.spyOn(worker, 'chargeToken')
    await generateRenewals(pool, { now, adapter: worker, returnOrigin: origin, subscription_id: f.subscription.id })
    expect(charge).not.toHaveBeenCalled()
    const attempt = (await pool.query("SELECT a.token_charge,a.status FROM payment_attempts a JOIN orders o ON o.id=a.order_id WHERE o.subscription_id=$1 AND o.kind='renewal' ORDER BY a.created_at DESC LIMIT 1", [f.subscription.id])).rows[0]
    expect(attempt).toEqual({ token_charge: false, status: 'redirected' })
    const due = (await pool.query("SELECT due_at FROM invoices WHERE subscription_id=$1 AND status='issued' ORDER BY due_at DESC LIMIT 1", [f.subscription.id])).rows[0].due_at
    await applyDunning(pool, { now: new Date(new Date(due).getTime() + 1000) })
    expect((await sub(f.subscription.id)).state).toBe('past_due')
  })

  it('never puts the token into an error message', async () => {
    const adapter = new SimulatorAdapter()
    const error = await adapter.getToken('sim_tok_secret_token_value').catch(e => e)
    expect(String(error.message)).not.toContain('secret_token_value')
    await expect(adapter.chargeToken({ given_id: 'x', token: 'sim_tok_secret_token_value', amount: money(100), description: 'd', callback_url: 'https://liwan.test/x' }))
      .rejects.not.toThrow(/secret_token_value/)
  })

  it('treats pricing that owes nothing as nothing to notify, invoice or dunn', () => {
    const none = { base_minor: 0, bundle_minor: {}, paid_users: 2, paid_storage_gb: 3, paid_extra_branches: 0, user_unit_minor: 0, storage_unit_minor: 0, branch_unit_minor: 0 }
    expect(owesAtRenewal(none)).toBe(false)
    expect(owesAtRenewal({ ...none, bundle_minor: { a: 19900 } })).toBe(true)
    expect(owesAtRenewal({ ...none, user_unit_minor: 2900 })).toBe(true)
    expect(owesAtRenewal(undefined)).toBe(true)
  })

  describe('the notice before the charge', () => {
    const mail = () => { const sent: { to: string; text: string }[] = []; return { sent, adapter: { send: async (m: { to: string; text: string }) => { sent.push(m) } } as any } }
    async function noticeFixture(renewalAt: string) {
      const f = await dueWithToken('sim_tok_0a0b0c0d_9')
      await pool.query('UPDATE subscriptions SET renewal_at=$2,revision=revision+1 WHERE id=$1', [f.subscription.id, renewalAt])
      return f
    }
    it(`goes out ${RENEWAL_NOTICE_DAYS} days before renewal_at, once, and never before that`, async () => {
      const f = await noticeFixture('2026-11-27')
      const m = mail()
      await sendRenewalNotices(pool, { now: new Date('2026-11-19T09:00:00Z'), mail: m.adapter })
      expect(m.sent.filter(x => x.to === `${f.customer}@example.test`)).toHaveLength(0)
      await sendRenewalNotices(pool, { now: new Date('2026-11-20T09:00:00Z'), mail: m.adapter })
      await sendRenewalNotices(pool, { now: new Date('2026-11-24T09:00:00Z'), mail: m.adapter })
      const mine = m.sent.filter(x => x.to === `${f.customer}@example.test`)
      expect(mine).toHaveLength(1)
      expect(mine[0]!.text).toContain('2026-11-27')
      expect(mine[0]!.text).not.toContain(f.token)
    })
    it('is not sent after the customer turned it off', async () => {
      const off = await noticeFixture('2026-11-25')
      await pool.query('UPDATE subscriptions SET auto_renew_enabled=false,auto_renew_consent_at=NULL,provider_token_ref=NULL,revision=revision+1 WHERE id=$1', [off.subscription.id])
      const m = mail()
      await sendRenewalNotices(pool, { now, mail: m.adapter })
      expect(m.sent.filter(x => x.to === `${off.customer}@example.test`)).toHaveLength(0)
    })
    it('retries a failed send on the next run and sends it once', async () => {
      const f = await noticeFixture('2026-11-25')
      let fail = true
      const sent: string[] = []
      const flaky = { send: async (m: { to: string }) => { if (fail && m.to === `${f.customer}@example.test`) throw new Error('smtp down'); sent.push(m.to) } } as any
      await sendRenewalNotices(pool, { now, mail: flaky })
      fail = false
      await sendRenewalNotices(pool, { now, mail: flaky })
      await sendRenewalNotices(pool, { now, mail: flaky })
      expect(sent.filter(to => to === `${f.customer}@example.test`)).toHaveLength(1)
    })
  })

  describe('the customer API', () => {
    async function call(tenant: string, path: string, body: unknown, caps = ['subscription.manage', 'billing.read']) {
      const raw = JSON.stringify(body)
      const principal = { actor_id: '7', kind: 'customer', tenant_id: tenant, capabilities: caps }
      const header = Buffer.from(JSON.stringify(principal)).toString('base64')
      const signed = signServiceRequest({ method: 'POST', path, body: `liwan-principal:${header}\n${raw}`, actor: 7, issuer: config.customerCommercialIssuer, key: config.customerCommercialServiceKey })
      return fetch(http + path, { method: 'POST', headers: { ...signed, 'x-liwan-principal': header, 'content-type': 'application/json' }, body: raw })
    }
    it('turns it off: the token is forgotten and revoked, the consent withdrawn, and it cannot be turned on without paying again', async () => {
      const f = await dueWithToken('sim_tok_0a0b0c0d_6')
      const response = await call(f.tenant, '/v1/customer/auto-renew', { enabled: false })
      expect(response.status).toBe(200)
      const body = await response.json()
      expect(body.auto_renew).toMatchObject({ enabled: false, consent_at: null, token_ref_present: false })
      expect(JSON.stringify(body)).not.toContain(f.token)
      expect(await sub(f.subscription.id)).toMatchObject({ auto_renew_enabled: false, auto_renew_consent_at: null, provider_token_ref: null })
      expect((await pool.query("SELECT count(*)::int AS n FROM audit_events WHERE action='subscription.auto_renew_disabled' AND subject=$1", [f.subscription.id])).rows[0].n).toBe(1)
      // Turning it off again changes nothing; turning it on here is refused outright.
      expect((await call(f.tenant, '/v1/customer/auto-renew', { enabled: false })).status).toBe(200)
      expect((await pool.query("SELECT count(*)::int AS n FROM audit_events WHERE action='subscription.auto_renew_disabled' AND subject=$1", [f.subscription.id])).rows[0].n).toBe(1)
      expect((await call(f.tenant, '/v1/customer/auto-renew', { enabled: true, consent: true })).status).toBe(422)
    })
    it('needs the subscription capability', async () => {
      const f = await dueWithToken('sim_tok_0a0b0c0d_5')
      expect((await call(f.tenant, '/v1/customer/auto-renew', { enabled: false }, ['billing.read'])).status).toBe(403)
      expect((await sub(f.subscription.id)).auto_renew_enabled).toBe(true)
    })
    it('starts a payment with the consent only when it is spelled out', async () => {
      const f = await converted()
      const path = `/v1/customer/orders/${f.order.id}/payment-attempts`
      expect((await call(f.tenant, path, { idempotency_key: randomUUID(), save_payment_method: true })).status).toBe(422)
      expect((await call(f.tenant, path, { idempotency_key: randomUUID(), save_payment_method: { consent: false } })).status).toBe(422)
      expect((await pool.query('SELECT count(*)::int AS n FROM payment_attempts WHERE order_id=$1 AND save_payment_method', [f.order.id])).rows[0].n).toBe(0)
    })
  })
})
