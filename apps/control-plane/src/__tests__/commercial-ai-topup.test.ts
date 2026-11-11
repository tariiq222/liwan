import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { Pool } from 'pg'
import { randomUUID } from 'node:crypto'
import type { Principal } from '@liwan/commercial-contracts'
import { url, setup, client, money, monthly } from './commercial-helpers.js'
import { createQuoteForCustomer } from '../commercial/quotes.js'
import { acceptQuote } from '../commercial/orders.js'
import { routesB } from '../commercial/routes-b.js'
import { createPaymentAttempt, handleProviderEvent } from '../commercial/payments.js'
import { SimulatorAdapter } from '../commercial/payment-simulator.js'
import { fixedReturnOrigin } from '../commercial/return-origin.js'
import { applyReceipt, failFulfillment, processFulfillmentOutbox } from '../commercial/fulfillment.js'
import { generateRenewals } from '../commercial/renewals.js'
import { customerCatalog } from '../commercial/customer-http.js'
import { deliveredEntitlement, grantedUnits, markTopupRefunded } from '../commercial/ai-ledger.js'
import { requestInvoiceRefund } from '../commercial/settlements.js'
import { extendTrial, pushCommercialExpiry } from '../commercial/trial.js'
import { transaction } from '../db.js'
import { expireSharedLeases } from '../shared/job-worker.js'
import { dispatchSharedOnce } from '../shared/job-dispatcher.js'
import { collectUsage } from '../commercial/usage-collector.js'
import { reconcileAfterRestore, fakeObserveRunner } from '../shared/subscription-reconcile.js'
import { enqueueReconfigureJob } from '../shared/job-store.js'
import { assertReconfigureAuthority, runSubscriptionReconfigure } from '../shared/subscription-reconfigure.js'

const suite = url ? describe : describe.skip
const POLICY_NO_TAX = '6f1c3d8e-0000-4000-8000-000000000002'
const caps = ['vendor.subscriptions.manage', 'vendor.tenants.manage', 'vendor.pricing.manage', 'vendor.billing.manage', 'vendor.read'] as any
const KEYS = ['ai.balance.granted', 'ai.allowance.trial', 'ai.allowance.monthly']

suite('AI balance top-up: quote, payment, ledger, delivery, refund', () => {
  const pool = new Pool({ connectionString: url, max: 6 })
  const api = client(pool)
  const adapter = new SimulatorAdapter()
  const runtime = { adapter, returnOrigin: fixedReturnOrigin('https://liwan.test') }
  const vendor = { actor_id: '7', kind: 'vendor', customer_id: null, tenant_id: null, capabilities: ['vendor.subscriptions.manage'] } as unknown as Principal
  let free: any, paid: any

  async function publishPlan(price: number, limits: Record<string, number | null> = {}) {
    const draft = await api('POST', '/plans', { name: `Topup ${randomUUID()}`, audience: { kind: 'public' }, term_months: 12, currency: 'SAR',
      prices: [{ cadence: monthly, amount: money(price) }], platform_limits: limits, included_bundle_revision_ids: [], optional_bundle_revision_ids: [],
      included_extra_branches: 0, extra_branch_prices: [{ cadence: monthly, amount: money(0) }], extra_branches_limit: null, included_users: 3, included_storage_mb: 20480,
      storage_step_mb: 10240, storage_step_threshold_mb: 102400, storage_large_step_mb: 102400, user_prices: [{ cadence: monthly, amount: money(0) }],
      storage_prices: [{ cadence: monthly, amount: money(0) }], policy_revision_id: POLICY_NO_TAX, trial_days: 0, grace_days: 0, auto_suspend: true, auto_renew_allowed: true })
    expect(draft.status, JSON.stringify(draft.body)).toBe(201)
    const validated = await api('POST', `/plans/${draft.body.id}/validate`, { edit_revision: 1, reason: 'AI top-up tests' })
    expect(validated.status, JSON.stringify(validated.body)).toBe(200)
    return (await api('POST', `/plans/${draft.body.id}/publish`, { edit_revision: validated.body.edit_revision, reason: 'AI top-up tests' })).body
  }
  beforeAll(async () => {
    const { version } = await setup(pool)
    await api('POST', '/catalog/releases', { catalog_version: version, reason: 'AI top-up tests' })
    free = await publishPlan(0)
    paid = await publishPlan(9900)
  })
  beforeEach(async () => {
    await pool.query('TRUNCATE customers CASCADE')
    await pool.query('TRUNCATE commercial_outbox')
    await pool.query("UPDATE ai_billing_settings SET topup_amounts_minor='{2500,5000,10000,25000,50000}',topup_minimum_minor=2500,usd_rate=3.75,trial_allowance_minor=500,monthly_allowance_minor=0")
    await pool.query('UPDATE billing_settings SET refund_window_days=14 WHERE singleton')
  })
  afterAll(async () => {
    // The scratch database is shared with the next file: leave the vendor settings as the migration seeded them.
    await pool.query("UPDATE ai_billing_settings SET topup_amounts_minor='{2500,5000,10000,25000,50000}',topup_minimum_minor=2500,usd_rate=3.75,trial_allowance_minor=500,monthly_allowance_minor=0")
    await pool.end()
  })

  async function customer(adminLogin: string | null = 'owner@example.test') {
    const tenant = randomUUID(), id = randomUUID(), slug = `t${tenant.replaceAll('-', '')}`
    await pool.query("INSERT INTO tenants(id,name,commercial_mode,hosting_model,inventory_target,operations_enabled) VALUES($1,'Topup','saas','dedicated_managed',$2,true)", [tenant, slug])
    await pool.query('INSERT INTO shared_registry_bindings(control_tenant_id,tenant_id,host,database_name,filestore,enabled,registry_revision) VALUES($1,$2,$3,$4,$4,true,1)', [tenant, slug, `${slug}.topup.test`, `liwan_scratch_${tenant.replaceAll('-', '')}`])
    await pool.query('INSERT INTO customers(id,name,tenant_id,admin_name,admin_login) VALUES($1,$2,$3,$4,$5)', [id, 'Topup customer', tenant, 'Owner', adminLogin])
    return id
  }
  const newRequest = (plan: any, topup?: number) => ({ kind: 'new' as const, plan_revision_id: plan.id, bundle_revision_ids: [], cadence: monthly,
    requested_extra_branches: 0, requested_users: 3, requested_storage_mb: 20480, ...(topup ? { ai_topup_minor: topup } : {}) })
  const order = async (customer_id: string, request: any, revision = 0) => {
    const quote = await createQuoteForCustomer(pool, { customer_id, request })
    return { quote, ...(await acceptQuote(pool, { quote_id: quote.id, expected_subscription_revision: quote.expected_subscription_revision ?? revision, idempotency_key: randomUUID() }, vendor)) }
  }
  /** Pays the order's invoice through the real settlement path (hosted attempt settled by the simulator). */
  async function pay(customer_id: string, order_id: string) {
    const attempt = await createPaymentAttempt(pool, { order_id, customer_id, adapter, returnOrigin: runtime.returnOrigin })
    const res = await routesB(pool, { method: 'POST', pathname: `/v1/commercial/payment-simulator/${attempt.id}/settle`, raw: JSON.stringify({ outcome: 'succeeded' }), issuer: 't', actor: 1, capabilities: caps, stepUpFresh: true },
      new URL('http://localhost/v1/commercial'), runtime)
    expect(res).toMatchObject({ data: { outcome: 'accepted' } })
    return attempt
  }
  const jobs = async (customer_id: string) => (await pool.query(`SELECT j.payload FROM shared_jobs j JOIN customers c ON c.tenant_id=j.control_tenant_id WHERE c.id=$1 AND j.payload->>'operation'='reconfigure' ORDER BY j.created_at`, [customer_id])).rows.map((r: any) => r.payload)
  async function apply(order_id: string) {
    await processFulfillmentOutbox(pool, { limit: 1000 })
    const o = (await pool.query('SELECT o.*,r.snapshot FROM orders o JOIN subscription_revisions r ON r.id=o.target_revision_id WHERE o.id=$1', [order_id])).rows[0]
    const job = (await pool.query("SELECT payload FROM shared_jobs WHERE payload->'authority'->>'order_id'=$1", [order_id])).rows[0].payload
    await applyReceipt(pool, { order_id, receipt: { order_id, tenant_id: job.binding.database, database: job.binding.database, target_revision_id: o.target_revision_id, observed_entitlement_digest: o.snapshot.entitlement.digest,
      observed_at: new Date().toISOString(), branch_bindings: [], modules_installed: [], root_company_id: 1 } as never })
    return job
  }

  it('quotes a top-up alone on a zero-priced first order: one charge-now line, nothing recurring', async () => {
    const id = await customer()
    const quote = await createQuoteForCustomer(pool, { customer_id: id, request: newRequest(free, 2500) })
    expect(quote.lines.filter(l => l.kind === 'ai_topup')).toHaveLength(1)
    expect(quote.due_now.minor).toBe(2500)
    expect(quote.next_renewal.minor).toBe(0)
    expect(quote.lines.filter(l => l.kind === 'ai_topup' && l.timing === 'renewal')).toHaveLength(0)
  })

  it('adds the top-up to other lines and keeps it out of the renewal', async () => {
    const id = await customer()
    const quote = await createQuoteForCustomer(pool, { customer_id: id, request: newRequest(paid, 10000) })
    expect(quote.due_now.minor).toBe(9900 + 10000)
    expect(quote.next_renewal.minor).toBe(9900)
  })

  it('refuses an amount the vendor does not offer, and a top-up on the anonymous preview', async () => {
    const id = await customer()
    await expect(createQuoteForCustomer(pool, { customer_id: id, request: newRequest(free, 3000) })).rejects.toMatchObject({ code: 'ai_topup_amount_not_offered', status: 422 })
    const preview = await api('POST', '/quotes', newRequest(free, 2500))
    expect(preview.status).toBe(422)
  })

  it('a paid first order on the free plan with only a top-up is accepted, paid once, and delivered with the three keys', async () => {
    const id = await customer()
    const { order: o } = await order(id, newRequest(free, 2500))
    expect(o).toMatchObject({ kind: 'new', payment_state: 'awaiting_payment' })
    const attempt = await pay(id, o.id)
    expect(await grantedUnits(pool, id)).toBe(666_666)
    // A repeated provider event for the same payment grants nothing more.
    const ref = (await pool.query('SELECT provider_ref FROM payment_attempts WHERE id=$1', [attempt.id])).rows[0].provider_ref
    await handleProviderEvent(pool, { provider: 'simulator', rawBody: adapter.webhookBody(ref), headers: {}, adapter })
    expect((await pool.query('SELECT count(*)::int AS n FROM ai_topups WHERE customer_id=$1', [id])).rows[0].n).toBe(1)
    expect(await grantedUnits(pool, id)).toBe(666_666)
    const job = await apply(o.id)
    const features = job.authority.entitlement.features
    expect(features).toMatchObject({ 'ai.balance.granted': 666_666, 'ai.allowance.trial': 133_333, 'ai.allowance.monthly': 0 })
    // The immutable snapshot carries them closed (0), never a live value, so nothing can go stale in it and the overlay always wins.
    const snapshot = (await pool.query('SELECT snapshot FROM subscription_revisions WHERE id=$1', [o.target_revision_id])).rows[0].snapshot
    for (const key of KEYS) expect(snapshot.entitlement.features[key]).toBe(0)
    expect(job.authority.entitlement.digest).toBe(snapshot.entitlement.digest)
  })

  it('a first order with a top-up still needs a reachable manager', async () => {
    const id = await customer(null)
    await pool.query('UPDATE customers SET tenant_id=NULL WHERE id=$1', [id])
    const quote = await createQuoteForCustomer(pool, { customer_id: id, request: newRequest(free, 2500) })
    await expect(acceptQuote(pool, { quote_id: quote.id, expected_subscription_revision: 0, idempotency_key: randomUUID() }, vendor)).rejects.toMatchObject({ code: 'admin_login_required' })
  })

  it('a second top-up accumulates, and a later delivery carries the live total, never a stale one', async () => {
    const id = await customer()
    const first = (await order(id, newRequest(free, 2500))).order
    await pay(id, first.id); await apply(first.id)
    const sub = (await pool.query('SELECT id,revision FROM subscriptions WHERE customer_id=$1', [id])).rows[0]
    const second = (await order(id, { ...newRequest(free, 5000), kind: 'change', subscription_id: sub.id, expected_subscription_revision: sub.revision })).order
    expect(second.kind).toBe('change')
    await pay(id, second.id)
    expect(await grantedUnits(pool, id)).toBe(666_666 + 1_333_333)
    const job = await apply(second.id)
    expect(job.authority.entitlement.features['ai.balance.granted']).toBe(666_666 + 1_333_333)
    // A renewal or reconcile re-delivers the applied snapshot: the helper reads the ledger, not the snapshot.
    const applied = (await pool.query('SELECT r.snapshot FROM subscriptions s JOIN subscription_revisions r ON r.id=s.applied_revision_id WHERE s.customer_id=$1', [id])).rows[0].snapshot
    const redelivered = await deliveredEntitlement(pool, id, applied.entitlement)
    expect(redelivered.features['ai.balance.granted']).toBe(666_666 + 1_333_333)
    expect(redelivered.digest).toBe(applied.entitlement.digest)
  })

  it('a renewal never charges the top-up again', async () => {
    const id = await customer()
    const o = (await order(id, newRequest(paid, 2500))).order
    await pool.query("UPDATE orders SET payment_state='paid',fulfillment_state='applied' WHERE id=$1", [o.id])
    await pool.query("UPDATE invoices SET status='paid',paid_at=now() WHERE order_id=$1", [o.id])
    await pool.query("UPDATE subscriptions SET applied_revision_id=target_revision_id,target_revision_id=NULL,state='active',renewal_at='2026-11-01',revision=revision+1 WHERE customer_id=$1", [id])
    await generateRenewals(pool, { now: new Date('2026-11-06T08:00:00Z'), adapter, returnOrigin: runtime.returnOrigin })
    const kinds = (await pool.query(`SELECT l.kind FROM invoice_lines l JOIN invoices i ON i.id=l.invoice_id JOIN orders o ON o.id=i.order_id WHERE o.kind='renewal' AND o.customer_id=$1`, [id])).rows.map((r: any) => r.kind)
    expect(kinds).toContain('base')
    expect(kinds).not.toContain('ai_topup')
  })

  describe('refund', () => {
    const refund = (order_id: string, body: unknown) => routesB(pool, { method: 'POST', pathname: `/v1/commercial/ai-topups/${order_id}/refund`, raw: JSON.stringify(body), issuer: 't', actor: 7, capabilities: caps, stepUpFresh: true },
      new URL(`http://localhost/v1/commercial/ai-topups/${order_id}/refund`), runtime)
    async function paidTopup(plan = free, amount = 2500, applied = false) {
      const id = await customer()
      const o = (await order(id, newRequest(plan, amount))).order
      await pay(id, o.id)
      if (applied) await apply(o.id)
      return { id, o }
    }
    const actor = { issuer: 't', actorUid: 7 }
    const lastJobGranted = async (id: string) => (await jobs(id)).at(-1).authority.entitlement.features['ai.balance.granted']

    it('inside the window and unused: lowers the total, opens one credit note and reaches the tenant without any other order', async () => {
      const { id, o } = await paidTopup(free, 2500, true)
      expect(await lastJobGranted(id)).toBe(666_666)
      const r = await refund(o.id, { reason: 'Customer asked', units_used: 0 })
      expect(r!.data).toMatchObject({ units: 666_666, granted_units: 0 })
      expect(await grantedUnits(pool, id)).toBe(0)
      expect((await pool.query("SELECT amount_minor,origin,status FROM invoice_adjustments WHERE customer_id=$1", [id])).rows).toEqual([{ amount_minor: '2500', origin: 'vendor', status: 'pending' }])
      expect(await lastJobGranted(id)).toBe(0)
      expect((await jobs(id))).toHaveLength(2)
      await expect(refund(o.id, { reason: 'Again', units_used: 0 })).rejects.toMatchObject({ code: 'refund_already_requested' })
    })
    it('the generic invoice refund lowers the ledger too, and a second refund of either kind is refused', async () => {
      const { id, o } = await paidTopup(free, 2500, true)
      const invoice = (await pool.query('SELECT id FROM invoices WHERE order_id=$1', [o.id])).rows[0]
      await requestInvoiceRefund(pool, { invoice_id: invoice.id, actor, reason: 'Generic refund', units_used: 0 })
      expect(await grantedUnits(pool, id)).toBe(0)
      expect(await lastJobGranted(id)).toBe(0)
      await expect(refund(o.id, { reason: 'Second way', units_used: 0 })).rejects.toMatchObject({ code: 'refund_already_requested' })
      await expect(requestInvoiceRefund(pool, { invoice_id: invoice.id, actor, reason: 'Generic again', units_used: 0 })).rejects.toMatchObject({ code: 'refund_already_requested' })
    })
    it('the generic invoice refund refuses a top-up that was used or whose use was not stated, and leaves no note behind', async () => {
      const { id, o } = await paidTopup(free, 2500, true)
      const invoice = (await pool.query('SELECT id FROM invoices WHERE order_id=$1', [o.id])).rows[0]
      await expect(requestInvoiceRefund(pool, { invoice_id: invoice.id, actor, reason: 'Used some', units_used: 5 })).rejects.toMatchObject({ code: 'ai_topup_used', status: 409 })
      await expect(requestInvoiceRefund(pool, { invoice_id: invoice.id, actor, reason: 'No units' })).rejects.toMatchObject({ code: 'units_used_required', status: 422 })
      expect((await pool.query('SELECT 1 FROM invoice_adjustments WHERE invoice_id=$1', [invoice.id])).rowCount).toBe(0)
      expect(await grantedUnits(pool, id)).toBe(666_666)
    })
    it('the generic invoice refund route takes the used units and refuses a used top-up', async () => {
      const { o } = await paidTopup(free, 2500, true)
      const invoice = (await pool.query('SELECT id FROM invoices WHERE order_id=$1', [o.id])).rows[0]
      const call = (body: unknown) => routesB(pool, { method: 'POST', pathname: `/v1/commercial/invoices/${invoice.id}/refund-request`, raw: JSON.stringify(body), issuer: 't', actor: 7, capabilities: caps, stepUpFresh: true },
        new URL(`http://localhost/v1/commercial/invoices/${invoice.id}/refund-request`), runtime)
      await expect(call({ reason: 'Used some', units_used: 3 })).rejects.toMatchObject({ code: 'ai_topup_used' })
      expect((await call({ reason: 'Unused', units_used: 0 }))!.status).toBe(201)
    })
    it('the top-up refund refuses when a credit note already exists on the invoice', async () => {
      const { o } = await paidTopup()
      const invoice = (await pool.query('SELECT id,customer_id FROM invoices WHERE order_id=$1', [o.id])).rows[0]
      await pool.query(`INSERT INTO invoice_adjustments(id,invoice_id,customer_id,kind,reason,amount_minor,currency,exponent,status,created_by,origin) VALUES($1,$2,$3,'credit_note','Provider refund',2500,'SAR',2,'pending','system','system')`, [randomUUID(), invoice.id, invoice.customer_id])
      await expect(refund(o.id, { reason: 'Over a note', units_used: 0 })).rejects.toMatchObject({ code: 'refund_already_requested' })
    })
    it('a provider refund or chargeback of the top-up order lowers the ledger and the tenant hears of it', async () => {
      const { id, o } = await paidTopup(free, 2500, true)
      const ref = (await pool.query('SELECT provider_ref FROM payment_attempts WHERE order_id=$1', [o.id])).rows[0].provider_ref
      await adapter.refund(ref.replace('sim_inv_', 'sim_pay_'))
      await handleProviderEvent(pool, { provider: 'simulator', rawBody: adapter.webhookBody(ref), headers: {}, adapter })
      expect(await grantedUnits(pool, id)).toBe(0)
      expect(await lastJobGranted(id)).toBe(0)
    })
    it('refuses once any of it was used', async () => {
      const { id, o } = await paidTopup()
      await expect(refund(o.id, { reason: 'Used some', units_used: 5 })).rejects.toMatchObject({ code: 'ai_topup_used', status: 409 })
      expect(await grantedUnits(pool, id)).toBe(666_666)
    })
    it('refuses outside the window', async () => {
      const { id, o } = await paidTopup()
      await pool.query("UPDATE payment_attempts SET succeeded_at=now()-interval '20 days' WHERE order_id=$1", [o.id])
      await expect(refund(o.id, { reason: 'Too late', units_used: 0 })).rejects.toMatchObject({ code: 'refund_window_closed' })
      expect(await grantedUnits(pool, id)).toBe(666_666)
    })
    it('refuses an order that bought more than the top-up, and a body without the used units', async () => {
      const { o } = await paidTopup(paid, 2500)
      await expect(refund(o.id, { reason: 'Mixed', units_used: 0 })).rejects.toMatchObject({ code: 'ai_topup_refund_mixed_order' })
      await expect(refund(o.id, { reason: 'No units' })).rejects.toMatchObject({ code: 'invalid' })
    })
  })

  it('a plan revision cannot set an AI key', async () => {
    for (const key of KEYS) {
      const draft = await api('POST', '/plans', { name: `Bad ${randomUUID()}`, audience: { kind: 'public' }, term_months: 12, currency: 'SAR', prices: [{ cadence: monthly, amount: money(0) }],
        platform_limits: { [key]: 5 }, included_bundle_revision_ids: [], optional_bundle_revision_ids: [], included_extra_branches: 0, extra_branch_prices: [], extra_branches_limit: null, included_users: 3,
        included_storage_mb: 0, storage_step_mb: 10240, storage_step_threshold_mb: 102400, storage_large_step_mb: 102400, user_prices: [], storage_prices: [], policy_revision_id: POLICY_NO_TAX,
        trial_days: 0, grace_days: 0, auto_suspend: true, auto_renew_allowed: true })
      const validated = draft.status === 201 ? await api('POST', `/plans/${draft.body.id}/validate`, { edit_revision: 1, reason: 'AI key' }) : draft
      expect(JSON.stringify(validated.body)).toContain('platform_limit_derived')
      expect(validated.status).toBe(422)
    }
  })

  it('refuses a total the entitlement cannot carry', async () => {
    const id = await customer()
    await pool.query("UPDATE ai_billing_settings SET usd_rate=0.01")
    const o = (await order(id, newRequest(free, 2500))).order
    await pool.query("INSERT INTO ai_topups(id,customer_id,order_id,amount_minor,currency,usd_rate,units) VALUES($1,$2,$3,2500,'SAR',3.75,999999000)", [randomUUID(), id, o.id])
    await expect(createQuoteForCustomer(pool, { customer_id: id, request: newRequest(free, 2500) })).rejects.toMatchObject({ code: 'ai_balance_limit_exceeded' })
  })

  it('the top-up grants what the quote showed even when the rate changes before payment', async () => {
    const id = await customer()
    const o = (await order(id, newRequest(free, 2500))).order
    await pool.query('UPDATE ai_billing_settings SET usd_rate=5')
    await pay(id, o.id)
    expect(await grantedUnits(pool, id)).toBe(666_666)
    expect((await pool.query('SELECT usd_rate::text AS r FROM ai_topups WHERE order_id=$1', [o.id])).rows[0].r).toBe('3.750000')
  })

  it('a payment that would pass the cap is acknowledged, credited back, and never throws', async () => {
    const id = await customer(), other = await customer('other@example.test')
    const o = (await order(id, newRequest(free, 2500))).order
    const filler = (await order(other, newRequest(free, 2500))).order
    // Another purchase landed first (two quotes were open at once): the ledger already holds almost the cap.
    await pool.query("INSERT INTO ai_topups(id,customer_id,order_id,amount_minor,currency,usd_rate,units) VALUES($1,$2,$3,2500,'SAR',3.75,999999000)", [randomUUID(), id, filler.id])
    await pay(id, o.id)
    expect(await grantedUnits(pool, id)).toBe(999_999_000)
    expect((await pool.query('SELECT payment_state,fulfillment_state FROM orders WHERE id=$1', [o.id])).rows[0]).toEqual({ payment_state: 'paid', fulfillment_state: 'failed' })
    expect((await pool.query("SELECT a.status FROM invoice_adjustments a JOIN invoices i ON i.id=a.invoice_id WHERE i.order_id=$1", [o.id])).rows).toEqual([{ status: 'pending' }])
    expect((await pool.query("SELECT 1 FROM commercial_outbox WHERE aggregate_id=$1 AND kind='fulfillment.enqueue'", [o.id])).rowCount).toBe(0)
    // A ledger over the cap still delivers, clamped.
    await pool.query('UPDATE ai_topups SET units=1500000000 WHERE customer_id=$1', [id])
    expect((await deliveredEntitlement(pool, id, { features: {} as Record<string, unknown> })).features['ai.balance.granted']).toBe(1_000_000_000)
  })

  it('trial extension, a repeated expiry push and a resumed subscription still deliver the granted total', async () => {
    const id = await customer()
    const o = (await order(id, newRequest(free, 2500))).order
    await pay(id, o.id); await apply(o.id)
    const sub = (await pool.query('SELECT id FROM subscriptions WHERE customer_id=$1', [id])).rows[0].id
    await transaction(pool, c => pushCommercialExpiry(c, sub, '2027-01-01'))
    let last = (await jobs(id)).at(-1)
    expect(last.authority.commercial_valid_until).toBe('2027-01-01')
    expect(last.authority.entitlement.features).toMatchObject({ 'ai.balance.granted': 666_666, 'ai.allowance.trial': 133_333 })
    await pool.query("UPDATE subscriptions SET state='trialing',trial_ends_at=now()+interval '3 days',revision=revision+1 WHERE id=$1", [sub])
    await extendTrial(pool, { subscription_id: sub, days: 5, reason: 'Extend after top-up', actor: 'vendor:7' })
    last = (await jobs(id)).at(-1)
    expect(last.authority.entitlement.features['ai.balance.granted']).toBe(666_666)
  })

  it('a changed trial allowance reaches an existing tenant without any order', async () => {
    const id = await customer()
    const o = (await order(id, newRequest(free, 2500))).order
    await pay(id, o.id); await apply(o.id)
    const before = (await jobs(id)).length
    const r = await routesB(pool, { method: 'PATCH', pathname: '/v1/commercial/ai-billing-settings', raw: JSON.stringify({ trial_allowance_minor: 1000, reason: `Allowance ${randomUUID()}` }), issuer: 't', actor: 7, capabilities: caps, stepUpFresh: true },
      new URL('http://localhost/v1/commercial/ai-billing-settings'))
    expect((r!.data as any).pushed_tenants).toBeGreaterThanOrEqual(1)
    const jobsNow = await jobs(id)
    expect(jobsNow).toHaveLength(before + 1)
    expect(jobsNow.at(-1).authority.entitlement.features).toMatchObject({ 'ai.allowance.trial': 266_666, 'ai.balance.granted': 666_666 })
  })

  it('a restore from a backup older than the top-up is repaired, and a current tenant is ready', async () => {
    const id = await customer()
    const o = (await order(id, newRequest(free, 2500))).order
    await pay(id, o.id); await apply(o.id)
    const row = (await pool.query('SELECT s.tenant_id,s.applied_revision_id,r.snapshot FROM subscriptions s JOIN subscription_revisions r ON r.id=s.applied_revision_id WHERE s.customer_id=$1', [id])).rows[0]
    const observed = (features: Record<string, number>) => fakeObserveRunner({ commercial_revision_id: row.applied_revision_id, commercial_digest: row.snapshot.entitlement.digest, status: 'active', commercial_valid_until: null, branches: [], features })
    const live = { 'ai.balance.granted': 666_666, 'ai.allowance.trial': 133_333, 'ai.allowance.monthly': 0 }
    expect(await reconcileAfterRestore(pool, { tenant_id: row.tenant_id, runner: observed(live) })).toEqual({ ready: true })
    const stale = await reconcileAfterRestore(pool, { tenant_id: row.tenant_id, runner: observed({ ...live, 'ai.balance.granted': 0 }) })
    expect(stale.ready).toBe(false)
    expect(stale.job_id).toBeTruthy()
  })

  describe('vendor settings and the customer catalog', () => {
    const settings = (method: string, body?: unknown, c = caps) => routesB(pool, { method, pathname: '/v1/commercial/ai-billing-settings', raw: body === undefined ? '' : JSON.stringify(body), issuer: 't', actor: 7, capabilities: c, stepUpFresh: true },
      new URL('http://localhost/v1/commercial/ai-billing-settings'))
    it('reads, updates with an audit row, and rejects invalid merges', async () => {
      expect((await settings('GET'))!.data).toEqual({ topup_amounts_minor: [2500, 5000, 10000, 25000, 50000], topup_minimum_minor: 2500, usd_rate: '3.750000', trial_allowance_minor: 500, monthly_allowance_minor: 0 })
      const reason = `Rate review ${randomUUID()}`
      const updated = await settings('PATCH', { usd_rate: '3.80', monthly_allowance_minor: 250, reason })
      expect(updated!.data).toMatchObject({ usd_rate: '3.800000', monthly_allowance_minor: 250 })
      expect((await pool.query("SELECT 1 FROM audit_events WHERE action='ai_billing.settings_updated' AND reason=$1", [reason])).rowCount).toBe(1)
      await expect(settings('PATCH', { topup_minimum_minor: 99999, reason: 'Too high' })).rejects.toMatchObject({ code: 'invalid', status: 422 })
      await expect(settings('PATCH', { usd_rate: 'abc', reason: 'Bad rate' })).rejects.toMatchObject({ code: 'invalid' })
      await expect(settings('PATCH', { usd_rate: '3.7' })).rejects.toMatchObject({ code: 'invalid' })
      await expect(settings('PATCH', { usd_rate: '3.7', reason: 'No grant' }, ['vendor.read'] as any)).rejects.toMatchObject({ code: 'forbidden', status: 403 })
    })
    it('the customer catalog carries the offer, the minimum and the rate', async () => {
      const id = await customer()
      expect((await customerCatalog(pool, id)).ai_topup).toEqual({ currency: 'SAR', exponent: 2, amounts_minor: [2500, 5000, 10000, 25000, 50000], minimum_minor: 2500, usd_rate: '3.750000' })
    })
  })

  describe('AI pushes run through the worker', () => {
    const delivered: Array<{ order_id: string; ai_push: boolean; features: Record<string, unknown> }> = []
    const runner = async ({ job }: { job: any }) => {
      delivered.push({ order_id: job.authority.order_id, ai_push: job.authority.ai_push === true, features: job.authority.entitlement.features })
      return { order_id: job.authority.order_id, tenant_id: job.binding.database, database: job.binding.database, target_revision_id: job.authority.target_revision_id,
        observed_entitlement_digest: job.authority.entitlement.digest, observed_at: new Date().toISOString(), branch_bindings: [], modules_installed: [], root_company_id: 1 } as never
    }
    beforeEach(() => { delivered.length = 0 })
    const jobId = async (order_id: string, aiPush: boolean) => (await pool.query(`SELECT id FROM shared_jobs WHERE payload->'authority'->>'order_id'=$1 AND (payload->'authority'->>'ai_push' IS NOT NULL)=$2 ORDER BY created_at DESC,id DESC LIMIT 1`, [order_id, aiPush])).rows[0]?.id as string | undefined
    const queued = async (customer_id: string) => (await pool.query(`SELECT j.id FROM shared_jobs j JOIN customers c ON c.tenant_id=j.control_tenant_id WHERE c.id=$1 AND j.state='queued' ORDER BY j.created_at,j.id`, [customer_id])).rows.map((r: any) => r.id as string)
    const stuck = async (customer_id: string) => (await pool.query(`SELECT j.id FROM shared_jobs j JOIN customers c ON c.tenant_id=j.control_tenant_id WHERE c.id=$1 AND j.state='needs_intervention'`, [customer_id])).rowCount
    /** The fulfilment job of an order, executed by the worker (not applied by hand), so the tenant's first revision is real. */
    async function applyViaWorker(order_id: string) {
      await processFulfillmentOutbox(pool, { limit: 1000 })
      const id = await jobId(order_id, false)
      expect(id).toBeTruthy()
      await runSubscriptionReconfigure(pool, id!, runner)
    }
    const providerRefund = async (order_id: string) => {
      const ref = (await pool.query('SELECT provider_ref FROM payment_attempts WHERE order_id=$1', [order_id])).rows[0].provider_ref
      await adapter.refund(ref.replace('sim_inv_', 'sim_pay_'))
      await handleProviderEvent(pool, { provider: 'simulator', rawBody: adapter.webhookBody(ref), headers: {}, adapter })
    }
    async function appliedTopup() {
      const id = await customer()
      const o = (await order(id, newRequest(free, 2500))).order
      await pay(id, o.id); await applyViaWorker(o.id)
      return { id, o }
    }
    async function paidChange(id: string) {
      const sub = (await pool.query('SELECT id,revision FROM subscriptions WHERE customer_id=$1', [id])).rows[0]
      const change = (await order(id, { ...newRequest(paid), kind: 'change', subscription_id: sub.id, expected_subscription_revision: sub.revision })).order
      await pay(id, change.id)
      return change
    }
    const patchSettings = (body: Record<string, unknown>) => routesB(pool, { method: 'PATCH', pathname: '/v1/commercial/ai-billing-settings', raw: JSON.stringify({ ...body, reason: `Settings ${randomUUID()}` }), issuer: 't', actor: 7, capabilities: caps, stepUpFresh: true },
      new URL('http://localhost/v1/commercial/ai-billing-settings'))

    it('a provider refund of the applied top-up order is authorised by the applied revision and lowers the delivered balance', async () => {
      const { id, o } = await appliedTopup()
      expect(delivered.at(-1)!.features['ai.balance.granted']).toBe(666_666)
      await providerRefund(o.id)
      expect((await pool.query('SELECT payment_state FROM orders WHERE id=$1', [o.id])).rows[0].payment_state).toBe('refunded')
      const push = await jobId(o.id, true)
      expect(push).toBeTruthy()
      await expect(runSubscriptionReconfigure(pool, push!, runner)).resolves.toMatchObject({ state: 'verified' })
      expect(delivered.at(-1)).toMatchObject({ ai_push: true, features: { 'ai.balance.granted': 0 } })
      expect(await stuck(id)).toBe(0)
    })

    it('the AI-push flag cannot apply a revision, a payment-less order or anything but the three AI keys', async () => {
      const { id, o } = await appliedTopup()
      await providerRefund(o.id)
      const base = (await pool.query('SELECT payload FROM shared_jobs WHERE id=$1', [await jobId(o.id, true)])).rows[0].payload
      const check = (patch: (job: any) => void, flag = true) => {
        const job = structuredClone(base)
        if (!flag) delete job.authority.ai_push
        patch(job)
        return transaction(pool, c => assertReconfigureAuthority(c, job))
      }
      await expect(check(() => {})).resolves.toBeUndefined()
      // Without the flag the refunded order authorises nothing: the rule for a job that applies a revision is unchanged.
      await expect(check(() => {}, false)).rejects.toThrow('order_not_released')
      await expect(check(job => { job.authority.entitlement.features['users.limit'] = 99 })).rejects.toThrow('ai_push_invalid')
      await expect(check(job => { job.authority.entitlement.modules = [...job.authority.entitlement.modules, 'liwan_crm'] })).rejects.toThrow('ai_push_invalid')
      await expect(check(job => { job.authority.branches.apply = [{ branch_id: randomUUID(), name: 'Extra' }] })).rejects.toThrow('ai_push_invalid')
      await expect(check(job => { job.authority.commercial_valid_until = '2030-01-01'; job.authority.commercial_valid_until_revision = 1 })).rejects.toThrow('ai_push_invalid')
      await expect(check(job => { job.authority.target_revision_id = randomUUID() })).rejects.toThrow('stale_target')
      await expect(check(job => { job.restore = true; job.restoreId = randomUUID() })).rejects.toThrow('ai_push_invalid')
      expect(await stuck(id)).toBe(0)
    })

    it('a settings change while a paid plan change is queued leaves one extra push, and after both run the tenant has the new revision and allowance', async () => {
      const { id } = await appliedTopup()
      const change = await paidChange(id)
      await processFulfillmentOutbox(pool, { limit: 1000 })
      const before = (await queued(id)).length
      await patchSettings({ trial_allowance_minor: 1000 })
      await patchSettings({ trial_allowance_minor: 1000, monthly_allowance_minor: 0 })
      const pending = await queued(id)
      expect(pending).toHaveLength(before + 1)
      for (const job of pending) await runSubscriptionReconfigure(pool, job, runner)
      expect(delivered.filter(d => d.order_id === change.id && !d.ai_push).at(-1)!.features).toMatchObject({ 'ai.allowance.trial': 266_666, 'ai.balance.granted': 666_666 })
      expect((await pool.query('SELECT applied_revision_id=$2 AS applied FROM subscriptions WHERE customer_id=$1', [id, change.target_revision_id])).rows[0].applied).toBe(true)
      expect(await queued(id)).toHaveLength(0)
      expect(await stuck(id)).toBe(0)
    })

    it('a provider refund while a paid plan change is queued leaves one extra push, and after both run the tenant has the new revision and the lowered balance', async () => {
      const { id, o } = await appliedTopup()
      const change = await paidChange(id)
      await processFulfillmentOutbox(pool, { limit: 1000 })
      const before = (await queued(id)).length
      await providerRefund(o.id)
      const pending = await queued(id)
      expect(pending).toHaveLength(before + 1)
      for (const job of pending) await runSubscriptionReconfigure(pool, job, runner)
      expect(delivered.filter(d => d.order_id === change.id && !d.ai_push).at(-1)!.features['ai.balance.granted']).toBe(0)
      expect((await pool.query('SELECT applied_revision_id=$2 AS applied FROM subscriptions WHERE customer_id=$1', [id, change.target_revision_id])).rows[0].applied).toBe(true)
      expect(await queued(id)).toHaveLength(0)
      expect(await stuck(id)).toBe(0)
    })

    it('an order stuck applying with no job does not stop a refund from reaching the tenant', async () => {
      const { id, o } = await appliedTopup()
      const change = await paidChange(id)
      await pool.query("UPDATE orders SET fulfillment_state='applying' WHERE id=$1", [change.id])
      await providerRefund(o.id)
      const push = await jobId(o.id, true)
      expect(push).toBeTruthy()
      await runSubscriptionReconfigure(pool, push!, runner)
      expect(delivered.at(-1)).toMatchObject({ ai_push: true, features: { 'ai.balance.granted': 0 } })
      expect(await stuck(id)).toBe(0)
    })

    it('an unpaid plan change does not hold back the push for the applied revision', async () => {
      const { id } = await appliedTopup()
      const sub = (await pool.query('SELECT id,revision FROM subscriptions WHERE customer_id=$1', [id])).rows[0]
      await order(id, { ...newRequest(paid), kind: 'change', subscription_id: sub.id, expected_subscription_revision: sub.revision })
      const r = await patchSettings({ trial_allowance_minor: 1000 })
      expect((r!.data as any).pushed_tenants).toBe(1)
    })

    it('a push that a newer revision overtook completes as superseded and never needs_intervention', async () => {
      const { id, o } = await appliedTopup()
      await patchSettings({ trial_allowance_minor: 1000 })
      const stale = await jobId(o.id, true)
      expect(stale).toBeTruthy()
      const change = await paidChange(id)
      await processFulfillmentOutbox(pool, { limit: 1000 })
      // The plan change runs first (the push was queued before it was built, but the worker order here is explicit).
      await runSubscriptionReconfigure(pool, (await jobId(change.id, false))!, runner)
      const result = await runSubscriptionReconfigure(pool, stale!, runner)
      expect(result).toMatchObject({ state: 'verified', receipt: { superseded: true } })
      expect((await pool.query('SELECT state FROM shared_jobs WHERE id=$1', [stale])).rows[0].state).toBe('verified')
      expect(await stuck(id)).toBe(0)
      expect(await queued(id)).toHaveLength(0)
    })

    it('a refund while a paid change is pending is pushed at once, and the change failing adds no second push', async () => {
      const { id, o } = await appliedTopup()
      const change = await paidChange(id)
      await providerRefund(o.id)
      expect(await queued(id)).toHaveLength(1)
      await failFulfillment(pool, { order_id: change.id, code: 'retries_exhausted' })
      const pending = await queued(id)
      expect(pending).toHaveLength(1)
      await runSubscriptionReconfigure(pool, pending[0]!, runner)
      expect(delivered.at(-1)).toMatchObject({ ai_push: true, features: { 'ai.balance.granted': 0 } })
      expect(await stuck(id)).toBe(0)
    })

    it('a superseded push queues nothing when the current revision already holds the live values', async () => {
      const { id, o } = await appliedTopup()
      await patchSettings({ trial_allowance_minor: 1000 })
      const stale = await jobId(o.id, true)
      const change = await paidChange(id)
      await processFulfillmentOutbox(pool, { limit: 1000 })
      await runSubscriptionReconfigure(pool, (await jobId(change.id, false))!, runner)
      await expect(runSubscriptionReconfigure(pool, stale!, runner)).resolves.toMatchObject({ receipt: { superseded: true } })
      expect(await queued(id)).toHaveLength(0)
    })

    it('a refund of a paid top-up that is still queued reaches a tenant that already received its units', async () => {
      const { id } = await appliedTopup()
      const sub = (await pool.query('SELECT id,revision FROM subscriptions WHERE customer_id=$1', [id])).rows[0]
      const second = (await order(id, { ...newRequest(free, 5000), kind: 'change', subscription_id: sub.id, expected_subscription_revision: sub.revision })).order
      await pay(id, second.id)
      await processFulfillmentOutbox(pool, { limit: 1000 })
      expect((await pool.query('SELECT fulfillment_state FROM orders WHERE id=$1', [second.id])).rows[0].fulfillment_state).toBe('queued')
      const pushes = async () => (await pool.query(`SELECT j.id FROM shared_jobs j JOIN customers c ON c.tenant_id=j.control_tenant_id WHERE c.id=$1 AND j.state='queued' AND j.payload->'authority'->>'ai_push'='true' ORDER BY j.created_at,j.id`, [id])).rows.map((r: any) => r.id as string)
      // An allowance change pushes the live values, which already include the unfulfilled top-up.
      await patchSettings({ trial_allowance_minor: 1000 })
      const [first] = await pushes()
      await runSubscriptionReconfigure(pool, first!, runner)
      expect(delivered.at(-1)).toMatchObject({ ai_push: true, features: { 'ai.balance.granted': 666_666 + 1_333_333 } })
      await providerRefund(second.id)
      const [refunded] = await pushes()
      expect(refunded).toBeTruthy()
      await runSubscriptionReconfigure(pool, refunded!, runner)
      expect(delivered.at(-1)).toMatchObject({ ai_push: true, features: { 'ai.balance.granted': 666_666 } })
      expect(await stuck(id)).toBe(0)
    })

    it('an expired AI push is failed (blocks nothing); the sweep re-sends', async () => {
      const { id, o } = await appliedTopup()
      await patchSettings({ trial_allowance_minor: 1000 })
      const push = (await jobId(o.id, true))!
      await pool.query(`UPDATE shared_jobs SET state='running',attempt_id=gen_random_uuid(),fence=fence+1,lease_until=clock_timestamp()-interval '1 second',journal='{"stage":"started"}'::jsonb WHERE id=$1`, [push])
      const log = vi.spyOn(console, 'error').mockImplementation(() => {})
      await expireSharedLeases(pool)
      log.mockRestore()
      expect((await pool.query('SELECT state FROM shared_jobs WHERE id=$1', [push])).rows[0].state).toBe('failed')
      expect(await stuck(id)).toBe(0)
      const change = await paidChange(id)
      await processFulfillmentOutbox(pool, { limit: 1000 })
      await expect(runSubscriptionReconfigure(pool, (await jobId(change.id, false))!, runner)).resolves.toMatchObject({ state: 'verified' })
    })

    describe('the sweep and the one push rule', () => {
      /** What a tenant's profile reports through the usage observation. */
      const observation = (database: string, ai: Record<string, number>) => ({ database, observed_at: new Date().toISOString(),
        usage: { 'users.limit': 1, 'storage.limit_mb': 0, 'branches.extra_limit': 0 }, limit_gates: { 'users.limit': [], 'storage.limit_mb': [], 'branches.extra_limit': [] }, features: ai })
      const databaseOf = async (id: string) => (await pool.query('SELECT b.database_name FROM subscriptions s JOIN shared_registry_bindings b ON b.control_tenant_id=s.tenant_id WHERE s.customer_id=$1', [id])).rows[0].database_name as string
      const sweep = async (held: Record<string, Record<string, number>>, log: (m: string) => void = () => {}) =>
        collectUsage(pool, { runner: async ({ database }) => held[database] ? observation(database, held[database]!) : null, log })
      const aiPushes = async (id: string) => (await pool.query(`SELECT j.id FROM shared_jobs j JOIN customers c ON c.tenant_id=j.control_tenant_id WHERE c.id=$1 AND j.state='queued' AND j.payload->'authority'->>'ai_push'='true' ORDER BY j.created_at,j.id`, [id])).rows.map((r: any) => r.id as string)
      const refundTopup = (order_id: string) => transaction(pool, c => markTopupRefunded(c, order_id, 'system', 'test refund'))
      const live = { 'ai.balance.granted': 666_666, 'ai.allowance.trial': 133_333, 'ai.allowance.monthly': 0 }

      it('a push that failed because the tenant was unreachable is re-queued by the next collector run, and then delivers', async () => {
        const { id, o } = await appliedTopup()
        await refundTopup(o.id)
        const push = (await aiPushes(id))[0]!
        const log = vi.spyOn(console, 'error').mockImplementation(() => {})
        await expect(runSubscriptionReconfigure(pool, push, async () => { throw new Error('runtime_timeout') })).rejects.toThrow('runtime_timeout')
        log.mockRestore()
        expect((await pool.query('SELECT state FROM shared_jobs WHERE id=$1', [push])).rows[0].state).toBe('failed')
        expect(await aiPushes(id)).toHaveLength(0)
        const lines: string[] = []
        await sweep({ [await databaseOf(id)]: live }, m => lines.push(m))
        const next = await aiPushes(id)
        expect(next).toHaveLength(1)
        await runSubscriptionReconfigure(pool, next[0]!, runner)
        expect(delivered.at(-1)).toMatchObject({ ai_push: true, features: { 'ai.balance.granted': 0 } })
      })

      it('a tenant that holds more than the ledger while every job is verified is lowered by the sweep', async () => {
        const { id } = await appliedTopup()
        const lines: string[] = []
        await sweep({ [await databaseOf(id)]: { ...live, 'ai.balance.granted': 9_999_999 } }, m => lines.push(m))
        expect(lines.some(l => l.includes('ai.balance.granted') && l.includes('queued a correction'))).toBe(true)
        const [push] = await aiPushes(id)
        await runSubscriptionReconfigure(pool, push!, runner)
        expect(delivered.at(-1)).toMatchObject({ ai_push: true, features: { 'ai.balance.granted': 666_666 } })
      })

      it('a refund for a customer whose subscription is cancelled but whose tenant is still usable is corrected by the sweep', async () => {
        const { id, o } = await appliedTopup()
        await pool.query("UPDATE subscriptions SET state='cancelled',revision=revision+1 WHERE customer_id=$1", [id])
        await refundTopup(o.id)
        await pool.query("UPDATE shared_jobs SET state='failed' WHERE id = ANY($1::uuid[])", [await aiPushes(id)])
        await sweep({ [await databaseOf(id)]: live })
        const [push] = await aiPushes(id)
        expect(push).toBeTruthy()
        await runSubscriptionReconfigure(pool, push!, runner)
        expect(delivered.at(-1)).toMatchObject({ ai_push: true, features: { 'ai.balance.granted': 0 } })
      })

      it('among 60 tenants, the one whose push failed is observed first in the next pass and corrected', async () => {
        const target = await appliedTopup()
        const others = []
        for (let i = 0; i < 59; i++) others.push((await appliedTopup()).id)
        // Everyone was visited a moment ago; then the target's push fails.
        await pool.query('INSERT INTO usage_collection_attempts(tenant_id,attempted_at) SELECT tenant_id,now() FROM subscriptions ON CONFLICT (tenant_id) DO UPDATE SET attempted_at=now()')
        await refundTopup(target.o.id)
        const log = vi.spyOn(console, 'error').mockImplementation(() => {})
        await expect(runSubscriptionReconfigure(pool, (await aiPushes(target.id))[0]!, async () => { throw new Error('runtime_timeout') })).rejects.toThrow('runtime_timeout')
        log.mockRestore()
        const seen: string[] = []
        const database = await databaseOf(target.id)
        await collectUsage(pool, { limit: 1, runner: async ({ database: db }) => { seen.push(db); return db === database ? observation(db, live) : null } })
        expect(seen).toEqual([database])
        const [push] = await aiPushes(target.id)
        expect(push).toBeTruthy()
        await runSubscriptionReconfigure(pool, push!, runner)
        expect(delivered.at(-1)).toMatchObject({ ai_push: true, features: { 'ai.balance.granted': 0 } })
        expect(others).toHaveLength(59)
      }, 180000)

      it('queues nothing, and logs nothing, when the tenant already holds the live values', async () => {
        const { id } = await appliedTopup()
        const lines: string[] = []
        await sweep({ [await databaseOf(id)]: live }, m => lines.push(m))
        expect(lines.filter(l => l.includes('queued a correction'))).toHaveLength(0)
        expect(await aiPushes(id)).toHaveLength(0)
      })

      it('a refund committing while a push is being claimed is seen by that claim', async () => {
        const { id, o } = await appliedTopup()
        await patchSettings({ trial_allowance_minor: 1000 })
        const [push] = await aiPushes(id)
        const client = await pool.connect()
        try {
          await client.query('BEGIN')
          await markTopupRefunded(client, o.id, 'system', 'during claim')
          const claim = runSubscriptionReconfigure(pool, push!, runner)
          await new Promise(resolve => setTimeout(resolve, 300))
          await client.query('COMMIT')
          await claim
        } finally { client.release() }
        expect(delivered.at(-1)).toMatchObject({ order_id: o.id, features: { 'ai.balance.granted': 0 } })
      })

      it('a refund committing while a delivery completes is converged by its completion check', async () => {
        const { id, o } = await appliedTopup()
        await patchSettings({ trial_allowance_minor: 1000 })
        const [push] = await aiPushes(id)
        const client = await pool.connect()
        try {
          const during = async (input: { job: any }) => {
            await client.query('BEGIN')
            await markTopupRefunded(client, o.id, 'system', 'during completion')
            setTimeout(() => { void client.query('COMMIT') }, 300)
            return runner(input)
          }
          await runSubscriptionReconfigure(pool, push!, during as never)
        } finally { await new Promise(resolve => setTimeout(resolve, 400)); client.release() }
        const next = await aiPushes(id)
        expect(next).toHaveLength(1)
        await runSubscriptionReconfigure(pool, next[0]!, runner)
        expect(delivered.at(-1)).toMatchObject({ ai_push: true, features: { 'ai.balance.granted': 0 } })
        expect(await aiPushes(id)).toHaveLength(0)
      })

      it('a ledger change while the binding is disabled is corrected by the first sweep after it is enabled', async () => {
        const { id, o } = await appliedTopup()
        // The registry guard refuses direct edits; lift it for the one statement that flips the flag.
        const setEnabled = async (enabled: boolean) => {
          await pool.query('ALTER TABLE shared_registry_bindings DISABLE TRIGGER USER')
          try { await pool.query('UPDATE shared_registry_bindings SET enabled=$2 WHERE control_tenant_id=(SELECT tenant_id FROM customers WHERE id=$1)', [id, enabled]) } finally { await pool.query('ALTER TABLE shared_registry_bindings ENABLE TRIGGER USER') }
        }
        await setEnabled(false)
        await refundTopup(o.id)
        expect(await aiPushes(id)).toHaveLength(0)
        await setEnabled(true)
        await sweep({ [await databaseOf(id)]: live })
        const [push] = await aiPushes(id)
        expect(push).toBeTruthy()
        await runSubscriptionReconfigure(pool, push!, runner)
        expect(delivered.at(-1)).toMatchObject({ ai_push: true, features: { 'ai.balance.granted': 0 } })
      })

      it('a settings change with one tenant unreachable converges the others now and that one at the sweep', async () => {
        const a = await appliedTopup(), b = await appliedTopup()
        await patchSettings({ trial_allowance_minor: 1000 })
        const log = vi.spyOn(console, 'error').mockImplementation(() => {})
        await expect(runSubscriptionReconfigure(pool, (await aiPushes(a.id))[0]!, async () => { throw new Error('runtime_timeout') })).rejects.toThrow('runtime_timeout')
        log.mockRestore()
        await runSubscriptionReconfigure(pool, (await aiPushes(b.id))[0]!, runner)
        expect(delivered.at(-1)).toMatchObject({ ai_push: true, features: { 'ai.allowance.trial': 266_666 } })
        expect(await aiPushes(a.id)).toHaveLength(0)
        await sweep({ [await databaseOf(a.id)]: live })
        await runSubscriptionReconfigure(pool, (await aiPushes(a.id))[0]!, runner)
        expect(delivered.at(-1)).toMatchObject({ ai_push: true, features: { 'ai.allowance.trial': 266_666 } })
      })

      it('a push runs when the tenant only has a job in needs_intervention, and waits behind a running one', async () => {
        const { id } = await appliedTopup()
        // Jobs left by earlier tests belong to other tenants; the dispatcher picks the oldest queued job of any tenant.
        await pool.query("UPDATE shared_jobs SET state='failed' WHERE state='queued' AND control_tenant_id NOT IN (SELECT tenant_id FROM customers WHERE id=$1)", [id])
        const change = await paidChange(id)
        await processFulfillmentOutbox(pool, { limit: 1000 })
        const blocker = (await jobId(change.id, false))!
        await pool.query("UPDATE shared_jobs SET state='needs_intervention' WHERE id=$1", [blocker])
        await patchSettings({ trial_allowance_minor: 1000 })
        const adapter = { subscriptionRunner: runner } as never
        await expect(dispatchSharedOnce(pool, adapter)).resolves.toMatchObject({ state: 'verified' })
        expect(delivered.at(-1)).toMatchObject({ ai_push: true, features: { 'ai.allowance.trial': 266_666 } })
        await pool.query("UPDATE shared_jobs SET state='running',attempt_id=gen_random_uuid(),lease_until=clock_timestamp()+interval '60 seconds' WHERE id=$1", [blocker])
        await patchSettings({ trial_allowance_minor: 2000 })
        const [push] = await aiPushes(id)
        await expect(dispatchSharedOnce(pool, adapter)).resolves.toMatchObject({ state: 'idle' })
        await expect(runSubscriptionReconfigure(pool, push!, runner)).rejects.toThrow('shared_reconciliation_required')
      })

      it('an AI push behind a quarantined plan change is refused by a tenant already on the new revision, ends failed, and the resolved change delivers the lowered balance', async () => {
        const { id, o } = await appliedTopup()
        await pool.query("UPDATE shared_jobs SET state='failed' WHERE state='queued' AND control_tenant_id NOT IN (SELECT tenant_id FROM customers WHERE id=$1)", [id])
        const change = await paidChange(id)
        await processFulfillmentOutbox(pool, { limit: 1000 })
        const quarantined = (await jobId(change.id, false))!
        // The tenant already moved to the change's revision, but the control plane lost the receipt and quarantined the job.
        await pool.query("UPDATE shared_jobs SET state='needs_intervention' WHERE id=$1", [quarantined])
        const tenantRevision = change.target_revision_id
        const tenantRunner = async (input: { job: any }) => {
          if (input.job.authority.ai_push && input.job.authority.target_revision_id !== tenantRevision) throw new Error('stale_target')
          return runner(input)
        }
        await refundTopup(o.id)
        const deliveriesBefore = delivered.length
        const log = vi.spyOn(console, 'error').mockImplementation(() => {})
        await expect(dispatchSharedOnce(pool, { subscriptionRunner: tenantRunner } as never)).rejects.toThrow('stale_target')
        log.mockRestore()
        expect(delivered.length).toBe(deliveriesBefore)
        const push = (await pool.query("SELECT state FROM shared_jobs WHERE payload->'authority'->>'ai_push'='true' AND control_tenant_id=(SELECT tenant_id FROM customers WHERE id=$1) ORDER BY created_at DESC LIMIT 1", [id])).rows[0]
        expect(push.state).toBe('failed')
        // The operator resolves the change: it is re-run, and it delivers the live (lowered) values.
        await runSubscriptionReconfigure(pool, quarantined, tenantRunner as never, true)
        expect(delivered.at(-1)).toMatchObject({ order_id: change.id, ai_push: false, features: { 'ai.balance.granted': 0 } })
      })

      it('a queued push for a stale registry revision does not stand in for a new one', async () => {
        const { id } = await appliedTopup()
        await patchSettings({ trial_allowance_minor: 1000 })
        expect(await aiPushes(id)).toHaveLength(1)
        await pool.query('UPDATE shared_registry_bindings SET registry_revision=registry_revision+1 WHERE control_tenant_id=(SELECT tenant_id FROM customers WHERE id=$1)', [id])
        await patchSettings({ trial_allowance_minor: 2000 })
        expect(await aiPushes(id)).toHaveLength(2)
      })
    })

    describe('restore reconcile', () => {
      /** An approved restore target for the tenant, so a restore reconcile job can run. */
      async function approvedRestore(id: string) {
        const row = (await pool.query('SELECT s.tenant_id,s.applied_revision_id,r.snapshot,b.database_name,b.tenant_id AS slug FROM subscriptions s JOIN subscription_revisions r ON r.id=s.applied_revision_id JOIN shared_registry_bindings b ON b.control_tenant_id=s.tenant_id WHERE s.customer_id=$1', [id])).rows[0]
        const backup = randomUUID(), restore = randomUUID()
        await pool.query("INSERT INTO shared_backups(id,control_tenant_id,tenant_id,database_name,filestore,snapshot,database_sha256,filestore_sha256,artifact_path,consistency,created_by) VALUES($1,$2,$3,$4,$4,'{}'::jsonb,$5,$5,'/tmp/fixture-backup','verified','integration-fake:7')", [backup, row.tenant_id, row.slug, row.database_name, 'c'.repeat(64)])
        await pool.query("INSERT INTO shared_restore_approvals(id,backup_id,control_tenant_id,target_database,reason,expires_at) VALUES($1,$2,$3,$4,'integration fixture',now()+interval '1 hour')", [restore, backup, row.tenant_id, row.database_name])
        const observed = (features: Record<string, unknown>) => fakeObserveRunner({ commercial_revision_id: row.applied_revision_id, commercial_digest: row.snapshot.entitlement.digest, status: 'active', commercial_valid_until: null, branches: [], features: features as never })
        return { tenant: row.tenant_id as string, restore, observed }
      }
      const aiOf = (features: Record<string, unknown>) => Object.fromEntries(KEYS.map(k => [k, features[k]]))

      it('a restore repair that differs only in the AI keys runs although the applying order was refunded, and anything else is refused', async () => {
        const { id, o } = await appliedTopup()
        const { tenant, restore, observed } = await approvedRestore(id)
        const old = aiOf(delivered.at(-1)!.features)
        await providerRefund(o.id)
        const repair = await reconcileAfterRestore(pool, { tenant_id: tenant, restore_id: restore, runner: observed(old) })
        expect(repair.ready).toBe(false)
        expect(repair.job_id).toBeTruthy()
        const payload = (await pool.query('SELECT payload FROM shared_jobs WHERE id=$1', [repair.job_id])).rows[0].payload
        const tampered = structuredClone(payload)
        tampered.authority.entitlement.features['users.limit'] = 99
        await expect(transaction(pool, c => assertReconfigureAuthority(c, tampered))).rejects.toThrow('order_not_released')
        await expect(runSubscriptionReconfigure(pool, repair.job_id!, runner)).resolves.toMatchObject({ state: 'verified' })
        expect(delivered.at(-1)!.features).toMatchObject({ 'ai.balance.granted': 0 })
        expect(await reconcileAfterRestore(pool, { tenant_id: tenant, restore_id: restore, runner: observed(aiOf(delivered.at(-1)!.features)) })).toEqual({ ready: true })
      })

      it('allowance A, a repair queued, B before its claim, back to A: the next readiness check queues and runs a new repair and ends ready', async () => {
        const { id } = await appliedTopup()
        const { tenant, restore, observed } = await approvedRestore(id)
        const startA = aiOf(delivered.at(-1)!.features)
        const stale = { ...startA, 'ai.balance.granted': 0 }
        const first = await reconcileAfterRestore(pool, { tenant_id: tenant, restore_id: restore, runner: observed(stale) })
        expect(first.ready).toBe(false)
        // A queued repair is reused while it is outstanding.
        expect((await reconcileAfterRestore(pool, { tenant_id: tenant, restore_id: restore, runner: observed(stale) })).job_id).toBe(first.job_id)
        await patchSettings({ trial_allowance_minor: 1000 })
        await runSubscriptionReconfigure(pool, first.job_id!, runner)
        const heldB = aiOf(delivered.at(-1)!.features)
        expect(heldB['ai.allowance.trial']).toBe(266_666)
        await patchSettings({ trial_allowance_minor: 500 })
        const second = await reconcileAfterRestore(pool, { tenant_id: tenant, restore_id: restore, runner: observed(heldB) })
        expect(second.ready).toBe(false)
        expect(second.reason).toBeUndefined()
        expect(second.job_id).not.toBe(first.job_id)
        await runSubscriptionReconfigure(pool, second.job_id!, runner)
        expect(delivered.at(-1)!.features['ai.allowance.trial']).toBe(133_333)
        expect(await reconcileAfterRestore(pool, { tenant_id: tenant, restore_id: restore, runner: observed(aiOf(delivered.at(-1)!.features)) })).toEqual({ ready: true })
      })

      it('values changed after a restore reconcile job was queued are delivered by that job', async () => {
        const { id } = await appliedTopup()
        const { tenant, restore, observed } = await approvedRestore(id)
        const first = await reconcileAfterRestore(pool, { tenant_id: tenant, restore_id: restore, runner: observed({ ...aiOf(delivered.at(-1)!.features), 'ai.balance.granted': 0 }) })
        expect(first.ready).toBe(false)
        await patchSettings({ trial_allowance_minor: 1000 })
        await expect(runSubscriptionReconfigure(pool, first.job_id!, runner)).resolves.toMatchObject({ state: 'verified' })
        expect(delivered.at(-1)!.features).toMatchObject({ 'ai.allowance.trial': 266_666, 'ai.balance.granted': 666_666 })
      })

      it('values changed after a reconcile completed get a new delivery at the next readiness check, which then ends ready', async () => {
        const { id } = await appliedTopup()
        const { tenant, restore, observed } = await approvedRestore(id)
        const first = await reconcileAfterRestore(pool, { tenant_id: tenant, restore_id: restore, runner: observed({ ...aiOf(delivered.at(-1)!.features), 'ai.balance.granted': 0 }) })
        await runSubscriptionReconfigure(pool, first.job_id!, runner)
        const restored = aiOf(delivered.at(-1)!.features)
        expect(await reconcileAfterRestore(pool, { tenant_id: tenant, restore_id: restore, runner: observed(restored) })).toEqual({ ready: true })
        await patchSettings({ trial_allowance_minor: 2000 })
        const second = await reconcileAfterRestore(pool, { tenant_id: tenant, restore_id: restore, runner: observed(restored) })
        expect(second).toMatchObject({ ready: false })
        expect(second.reason).toBeUndefined()
        expect(second.job_id).not.toBe(first.job_id)
        await runSubscriptionReconfigure(pool, second.job_id!, runner)
        expect(delivered.at(-1)!.features['ai.allowance.trial']).toBe(533_333)
        expect(await reconcileAfterRestore(pool, { tenant_id: tenant, restore_id: restore, runner: observed(aiOf(delivered.at(-1)!.features)) })).toEqual({ ready: true })
      })
    })

    it('a failed AI push does not block the next paid order, and is logged', async () => {
      const { id, o } = await appliedTopup()
      await patchSettings({ trial_allowance_minor: 1000 })
      const push = await jobId(o.id, true)
      const log = vi.spyOn(console, 'error').mockImplementation(() => {})
      await expect(runSubscriptionReconfigure(pool, push!, async () => { throw new Error('observed_mismatch') })).rejects.toThrow('observed_mismatch')
      expect(log.mock.calls.some(call => String(call[0]).includes('AI balance push'))).toBe(true)
      log.mockRestore()
      expect((await pool.query('SELECT state FROM shared_jobs WHERE id=$1', [push])).rows[0].state).toBe('failed')
      expect(await stuck(id)).toBe(0)
      const change = await paidChange(id)
      await processFulfillmentOutbox(pool, { limit: 1000 })
      await expect(runSubscriptionReconfigure(pool, (await jobId(change.id, false))!, runner)).resolves.toMatchObject({ state: 'verified' })
      expect(delivered.at(-1)).toMatchObject({ order_id: change.id, features: { 'ai.allowance.trial': 266_666 } })
    })

    it('a push whose tenant has no subscription ends failed (visible, non-blocking) and is logged, never reported done', async () => {
      const { id, o } = await appliedTopup()
      await patchSettings({ trial_allowance_minor: 1000 })
      const push = await jobId(o.id, true)
      // The revision-conflict trigger guards the row; detach the tenant for the duration of this one statement.
      await pool.query('ALTER TABLE subscriptions DISABLE TRIGGER USER')
      try { await pool.query('UPDATE subscriptions SET tenant_id=NULL WHERE customer_id=$1', [id]) } finally { await pool.query('ALTER TABLE subscriptions ENABLE TRIGGER USER') }
      const log = vi.spyOn(console, 'error').mockImplementation(() => {})
      await expect(runSubscriptionReconfigure(pool, push!, runner)).rejects.toThrow('ai_push_no_subscription')
      const tenant = (await pool.query('SELECT control_tenant_id FROM shared_jobs WHERE id=$1', [push])).rows[0].control_tenant_id
      expect(log).toHaveBeenCalledWith(expect.stringContaining(`AI balance push ${push} for tenant ${tenant}`))
      log.mockRestore()
      const row = (await pool.query('SELECT state,journal FROM shared_jobs WHERE id=$1', [push])).rows[0]
      expect(row).toMatchObject({ state: 'failed', journal: { error_code: 'ai_push_no_subscription' } })
      expect(delivered.filter(d => d.order_id === o.id && d.ai_push)).toHaveLength(0)
    })

    it('refuses an AI push naming another revision of the subscription, or an order of another tenant', async () => {
      const { id, o } = await appliedTopup()
      const other = await appliedTopup()
      const change = await paidChange(id)
      await providerRefund(o.id)
      await failFulfillment(pool, { order_id: change.id, code: 'retries_exhausted' })
      const base = (await pool.query('SELECT payload FROM shared_jobs WHERE id=$1', [await jobId(o.id, true)])).rows[0].payload
      const check = (patch: (job: any) => void) => { const job = structuredClone(base); patch(job); return transaction(pool, c => assertReconfigureAuthority(c, job)) }
      await expect(check(() => {})).resolves.toBeUndefined()
      await expect(check(job => { job.authority.target_revision_id = change.target_revision_id; job.authority.previous_revision_id = change.target_revision_id })).rejects.toThrow('stale_target')
      await expect(check(job => { job.authority.order_id = other.o.id })).rejects.toThrow('order_not_released')
    })

    /** A runner that changes something while the job is between its claim and its completion. */
    const runnerDuring = (hook: () => Promise<unknown>) => async (input: { job: any }) => { await hook(); return runner(input) }

    it('a refund while a renewal is outstanding still reaches the tenant, and paying the renewal keeps the values', async () => {
      const id = await customer()
      const o = (await order(id, newRequest(paid, 2500))).order
      await pay(id, o.id); await applyViaWorker(o.id)
      await pool.query("UPDATE subscriptions SET state='active',renewal_at='2026-11-01',revision=revision+1 WHERE customer_id=$1", [id])
      await generateRenewals(pool, { now: new Date('2026-11-06T08:00:00Z'), adapter, returnOrigin: runtime.returnOrigin })
      const renewal = (await pool.query("SELECT id,fulfillment_state FROM orders WHERE customer_id=$1 AND kind='renewal'", [id])).rows[0]
      expect(renewal.fulfillment_state).not.toBe('applied')
      await providerRefund(o.id)
      const push = await jobId(o.id, true)
      expect(push).toBeTruthy()
      await expect(runSubscriptionReconfigure(pool, push!, runner)).resolves.toMatchObject({ state: 'verified' })
      expect(delivered.at(-1)).toMatchObject({ ai_push: true, features: { 'ai.balance.granted': 0 } })
      const jobsBefore = (await jobs(id)).length
      await pay(id, renewal.id)
      await processFulfillmentOutbox(pool, { limit: 1000 })
      expect((await pool.query('SELECT fulfillment_state FROM orders WHERE id=$1', [renewal.id])).rows[0].fulfillment_state).toBe('applied')
      expect(await jobs(id)).toHaveLength(jobsBefore)
      expect(await queued(id)).toHaveLength(0)
      expect(await stuck(id)).toBe(0)
    })

    it('an allowance changed while a plan change runs is pushed when the change completes, and that push ends the chain', async () => {
      const { id } = await appliedTopup()
      const change = await paidChange(id)
      await processFulfillmentOutbox(pool, { limit: 1000 })
      const during = runnerDuring(async () => { await pool.query('UPDATE ai_billing_settings SET trial_allowance_minor=1000') })
      await runSubscriptionReconfigure(pool, (await jobId(change.id, false))!, during as never)
      expect(delivered.at(-1)).toMatchObject({ order_id: change.id, ai_push: false, features: { 'ai.allowance.trial': 133_333 } })
      const next = await queued(id)
      expect(next).toHaveLength(1)
      await runSubscriptionReconfigure(pool, next[0]!, runner)
      expect(delivered.at(-1)).toMatchObject({ ai_push: true, features: { 'ai.allowance.trial': 266_666, 'ai.balance.granted': 666_666 } })
      expect(await queued(id)).toHaveLength(0)
      expect(await stuck(id)).toBe(0)
    })

    it('a refund while a plan change runs is pushed when the change completes', async () => {
      const { id, o } = await appliedTopup()
      const change = await paidChange(id)
      await processFulfillmentOutbox(pool, { limit: 1000 })
      await runSubscriptionReconfigure(pool, (await jobId(change.id, false))!, runnerDuring(() => providerRefund(o.id)) as never)
      expect(delivered.at(-1)).toMatchObject({ order_id: change.id, features: { 'ai.balance.granted': 666_666 } })
      // The push queued during the run targets the revision the change replaced (it completes superseded); the
      // completion check queues the one that reaches the new revision.
      const next = await queued(id)
      expect(next).toHaveLength(2)
      for (const job of next) await runSubscriptionReconfigure(pool, job, runner)
      expect(delivered.at(-1)).toMatchObject({ ai_push: true, features: { 'ai.balance.granted': 0 } })
      expect(await queued(id)).toHaveLength(0)
      expect(await stuck(id)).toBe(0)
    })

    it('unchanged values queue nothing when a plan change completes', async () => {
      const { id } = await appliedTopup()
      const change = await paidChange(id)
      await processFulfillmentOutbox(pool, { limit: 1000 })
      await runSubscriptionReconfigure(pool, (await jobId(change.id, false))!, runner)
      expect(await queued(id)).toHaveLength(0)
      expect((await pool.query("SELECT count(*)::int AS n FROM shared_jobs j JOIN customers c ON c.tenant_id=j.control_tenant_id WHERE c.id=$1 AND j.payload->'authority'->>'ai_push' IS NOT NULL", [id])).rows[0].n).toBe(0)
    })

    it('values that change after a fulfilment job was queued are delivered when it runs', async () => {
      const id = await customer()
      const o = (await order(id, newRequest(free, 2500))).order
      await pay(id, o.id)
      await processFulfillmentOutbox(pool, { limit: 1000 })
      expect((await jobs(id)).at(-1).authority.entitlement.features['ai.allowance.trial']).toBe(133_333)
      await pool.query('UPDATE ai_billing_settings SET trial_allowance_minor=1000')
      await runSubscriptionReconfigure(pool, (await jobId(o.id, false))!, runner)
      expect(delivered.at(-1)!.features['ai.allowance.trial']).toBe(266_666)
    })
  })
})
