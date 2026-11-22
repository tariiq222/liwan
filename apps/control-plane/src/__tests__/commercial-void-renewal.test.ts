import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { Pool } from 'pg'
import { setup, client, money, monthly, seedPaymentMethod, url } from './commercial-helpers.js'
import { routesB } from '../commercial/routes-b.js'
import { CommercialHttpError } from '../commercial/lifecycle.js'
import { acceptQuote } from '../commercial/orders.js'
import { createQuoteForCustomer } from '../commercial/quotes.js'
import { applyDunning, generateRenewals } from '../commercial/renewals.js'
import { chargeSavedCards } from '../commercial/saved-card-charges.js'
import { suspendSubscription, syncTenantStatus } from '../commercial/suspension.js'
import { createPaymentAttempt, handleProviderEvent } from '../commercial/payments.js'
import { SimulatorAdapter } from '../commercial/payment-simulator.js'
import { voidRenewalInvoice } from '../commercial/renewal-void.js'
import { processFreeBaseLocks } from '../commercial/free-base-lock.js'
import { processFulfillmentOutbox } from '../commercial/fulfillment.js'
import { recordUsage } from '../commercial/usage.js'
import { runSubscriptionReconfigure } from '../shared/subscription-reconfigure.js'
import { getVendorInvoice } from '../commercial/invoices.js'
import { fixedReturnOrigin } from '../commercial/return-origin.js'

const suite = url ? describe : describe.skip
suite('live PostgreSQL void of an unpaid renewal invoice', () => {
  const pool = new Pool({ connectionString: url, max: 8 }), api = client(pool)
  const vendor: any = { actor_id: '7', kind: 'vendor', customer_id: null, tenant_id: null, capabilities: ['vendor.subscriptions.manage'] }
  const now = new Date('2026-10-02T08:00:00Z')
  let plan: any

  beforeAll(async () => {
    const { version } = await setup(pool)
    await api('POST', '/catalog/releases', { catalog_version: version, reason: 'Void acceptance' })
    const c = await api('POST', '/plans', { name: `Void ${randomUUID()}`, audience: { kind: 'public' }, term_months: 12, currency: 'SAR', prices: [{ cadence: monthly, amount: money(10000) }], platform_limits: {},
      included_bundle_revision_ids: [], optional_bundle_revision_ids: [], included_extra_branches: 1, extra_branch_prices: [{ cadence: monthly, amount: money(5000) }], extra_branches_limit: null,
      included_users: 1, included_storage_mb: 0, storage_step_mb: 10240, storage_step_threshold_mb: 102400, storage_large_step_mb: 102400, user_prices: [{ cadence: monthly, amount: money(0) }],
      storage_prices: [{ cadence: monthly, amount: money(0) }], policy_revision_id: '6f1c3d8e-0000-4000-8000-000000000001', trial_days: 0, grace_days: 2, auto_suspend: true, auto_renew_allowed: true })
    const v = await api('POST', `/plans/${c.body.id}/validate`, { edit_revision: 1, reason: 'Void acceptance' })
    plan = (await api('POST', `/plans/${c.body.id}/publish`, { edit_revision: v.body.edit_revision, reason: 'Void acceptance' })).body
  })
  beforeEach(async () => { await pool.query('TRUNCATE customers CASCADE'); await pool.query('TRUNCATE commercial_outbox') })
  afterAll(async () => { await pool.query('TRUNCATE customers CASCADE'); await pool.query('TRUNCATE commercial_outbox'); await pool.end() })

  const origin = fixedReturnOrigin('https://liwan.test')
  const renew = (at: Date = now) => generateRenewals(pool, { now: at, returnOrigin: origin })

  /** A paid customer whose period ended on 2026-10-01 and whose renewal invoice was just issued, unpaid. */
  async function unpaidRenewal() {
    const customer = randomUUID(), tenant = randomUUID(), slug = `t${tenant.replaceAll('-', '')}`
    await pool.query("INSERT INTO tenants(id,name,commercial_mode,hosting_model,inventory_target,operations_enabled,post_trial_supported,excess_supported) VALUES($1,'Void','saas','shared_managed',$2,true,true,true)", [tenant, slug])
    await pool.query('INSERT INTO shared_registry_bindings(control_tenant_id,tenant_id,host,database_name,filestore,enabled,registry_revision) VALUES($1,$2,$3,$4,$4,true,1)', [tenant, slug, `${slug}.test`, `liwan_scratch_${slug.slice(1)}`])
    await pool.query('INSERT INTO customers(id,name,tenant_id,admin_name,admin_login) VALUES($1,$2,$3,$4,$5)', [customer, 'Void customer', tenant, 'Manager', `${customer}@example.test`])
    const quote = await createQuoteForCustomer(pool, { customer_id: customer, request: { kind: 'new', plan_revision_id: plan.id, bundle_revision_ids: [], cadence: monthly, requested_extra_branches: 0, requested_users: 1, requested_storage_mb: 0 } })
    const { order } = await acceptQuote(pool, { quote_id: quote.id, expected_subscription_revision: 0, idempotency_key: randomUUID() }, vendor)
    await pool.query("UPDATE orders SET payment_state='paid',fulfillment_state='applied' WHERE id=$1", [order.id])
    await pool.query("UPDATE invoices SET status='paid',paid_at=now() WHERE order_id=$1", [order.id])
    await pool.query("UPDATE subscriptions SET applied_revision_id=target_revision_id,target_revision_id=NULL,state='active',renewal_at='2026-10-01',revision=revision+1 WHERE id=$1", [order.subscription_id])
    await renew()
    const row = (await pool.query(`SELECT r.id AS renewal,r.order_id,r.invoice_id FROM renewals r WHERE r.subscription_id=$1`, [order.subscription_id])).rows[0]
    return { customer, tenant, subscription: order.subscription_id as string, renewal: row.renewal as string, order: row.order_id as string, invoice: row.invoice_id as string, firstOrder: order.id as string }
  }
  type Fixture = Awaited<ReturnType<typeof unpaidRenewal>>
  const attempt = (f: Fixture, status: string, kind = 'hosted_invoice') => pool.query(`INSERT INTO payment_attempts(id,order_id,invoice_id,provider,mode,provider_ref,amount_minor,currency,exponent,status,kind,succeeded_at)
    VALUES($1,$2,$3,'moyasar','live',$4,11500,'SAR',2,$5,$6,CASE WHEN $5='succeeded' THEN now() END)`, [randomUUID(), f.order, f.invoice, `ref-${randomUUID()}`, status, kind])
  const view = async (id: string) => (await getVendorInvoice(pool, id))!

  describe('the vendor invoice view says whether the invoice can be voided and why not', () => {
    it('an unpaid renewal invoice with nothing in the way is voidable', async () => {
      const f = await unpaidRenewal()
      expect(await view(f.invoice)).toMatchObject({ kind: 'renewal', status: 'issued', voidable: true, void_block: null })
    })
    it('any other invoice (paid, or not a renewal) offers no void at all', async () => {
      const f = await unpaidRenewal()
      const first = (await pool.query('SELECT id,status,kind FROM invoices WHERE subscription_id=$1 AND id<>$2', [f.subscription, f.invoice])).rows[0]
      expect(first).toMatchObject({ status: 'paid', kind: 'initial' })
      expect(await view(first.id)).toMatchObject({ voidable: false, void_block: null })
      await pool.query("UPDATE invoices SET status='void' WHERE id=$1", [f.invoice])
      expect(await view(f.invoice)).toMatchObject({ voidable: false, void_block: null })
    })
    it.each(['created', 'redirected', 'pending', 'unknown', 'succeeded'])('a %s payment attempt on the order blocks it until the payment is reconciled', async status => {
      const f = await unpaidRenewal()
      await attempt(f, status)
      expect(await view(f.invoice)).toMatchObject({ voidable: false, void_block: 'payment_reconciliation_required' })
    })
    it('a failed or cancelled attempt does not block it', async () => {
      const f = await unpaidRenewal()
      await attempt(f, 'failed'); await attempt(f, 'canceled')
      expect(await view(f.invoice)).toMatchObject({ voidable: true, void_block: null })
    })
    it('a customer bank-transfer claim blocks it: the vendor confirms the transfer first', async () => {
      const f = await unpaidRenewal()
      await pool.query("INSERT INTO bank_transfer_claims(invoice_id,value_date,sender_reference) VALUES($1,'2026-10-02','SA-1')", [f.invoice])
      expect(await view(f.invoice)).toMatchObject({ voidable: false, void_block: 'transfer_claimed' })
    })
    it('a renewal that is paid and still being applied blocks it', async () => {
      const f = await unpaidRenewal()
      await pool.query("UPDATE orders SET payment_state='paid',fulfillment_state='queued' WHERE id=$1", [f.order])
      expect(await view(f.invoice)).toMatchObject({ voidable: false, void_block: 'renewal_in_progress' })
    })
    it('a free-base lock in flight blocks it', async () => {
      const f = await unpaidRenewal()
      const sub = (await pool.query('SELECT applied_revision_id FROM subscriptions WHERE id=$1', [f.subscription])).rows[0]
      await pool.query(`INSERT INTO free_base_locks(subscription_id,pre_lock_revision_id,period_start,armed_at,trial_ended_at,cause,next_attempt_at) VALUES($1,$2,'2026-10-01',now(),NULL,'cancelled',now())`, [f.subscription, sub.applied_revision_id])
      expect(await view(f.invoice)).toMatchObject({ voidable: false, void_block: 'lock_pending' })
    })
    it('a workspace being deleted blocks it', async () => {
      const f = await unpaidRenewal()
      await pool.query(`INSERT INTO tenant_deletion_requests(id,customer_id,state,requested_at,requested_by,confirmed_at,confirmed_by,due_at,due_marked_at,hold_until,deleting_at,plan,plan_digest,renewal_outcome,renewal_refusal)
        VALUES($1,$2,'deleting',now(),'t',now(),'t',now(),now(),now(),now(),'{}'::jsonb,$3,'not_cancellable','no_subscription')`, [randomUUID(), f.customer, 'a'.repeat(64)])
      expect(await view(f.invoice)).toMatchObject({ voidable: false, void_block: 'tenant_retiring' })
    })
    it('a trial checkout invoice is never voidable here: its own void keeps the trial consistent', async () => {
      const f = await unpaidRenewal()
      // The key is immutable for the application; the fixture rewrites it with the triggers off, as the trial conversion would have written it.
      const c = await pool.connect()
      try { await c.query('BEGIN'); await c.query("SET LOCAL session_replication_role=replica"); await c.query("UPDATE orders SET idempotency_key='trial-checkout:'||idempotency_key WHERE id=$1", [f.order]); await c.query('COMMIT') } finally { c.release() }
      expect(await view(f.invoice)).toMatchObject({ voidable: false, void_block: null })
    })
  })

  const callVoid = (f: Fixture, over: Partial<Parameters<typeof voidRenewalInvoice>[1]> = {}) =>
    voidRenewalInvoice(pool, { invoice_id: f.invoice, actor: 'account:7', reason: 'Customer will not pay', outcome: 'rebill', ...over } as Parameters<typeof voidRenewalInvoice>[1])
  const sub = async (id: string) => (await pool.query('SELECT * FROM subscriptions WHERE id=$1', [id])).rows[0]
  const orderRow = async (id: string) => (await pool.query('SELECT cancelled,automatic_refund,payment_state FROM orders WHERE id=$1', [id])).rows[0]
  const renewalRow = async (id: string) => (await pool.query('SELECT status FROM renewals WHERE id=$1', [id])).rows[0].status
  const dueAt = async (f: Fixture) => new Date((await pool.query('SELECT due_at FROM invoices WHERE id=$1', [f.invoice])).rows[0].due_at)
  const afterDue = async (f: Fixture, days: number) => new Date((await dueAt(f)).getTime() + days * 86_400_000 + 1000)
  /** Every row the void would touch, to prove a refusal changed nothing. */
  const snapshot = async (f: Fixture) => ({ sub: await sub(f.subscription), order: (await pool.query('SELECT * FROM orders WHERE id=$1', [f.order])).rows[0],
    invoice: (await pool.query('SELECT status FROM invoices WHERE id=$1', [f.invoice])).rows[0], renewal: await renewalRow(f.renewal),
    audits: (await pool.query("SELECT count(*)::int AS n FROM audit_events WHERE action='invoice.voided' AND subject=$1", [f.invoice])).rows[0].n })

  describe('voiding with the rebill outcome', () => {
    it('voids the invoice, cancels the order for automatic refund and frees the period, leaving an active subscription as it is', async () => {
      const f = await unpaidRenewal()
      const before = await sub(f.subscription)
      const result = await callVoid(f)
      expect(result).toMatchObject({ id: f.invoice, status: 'void', voidable: false, void_block: null })
      expect(await orderRow(f.order)).toMatchObject({ cancelled: true, automatic_refund: true, payment_state: 'awaiting_payment' })
      expect(await renewalRow(f.renewal)).toBe('superseded')
      expect(await sub(f.subscription)).toMatchObject({ state: 'active', revision: before.revision })
      expect((await pool.query("SELECT count(*)::int AS n FROM invoice_adjustments WHERE invoice_id=$1", [f.invoice])).rows[0].n).toBe(0)
    })
    it('records who voided it, why, and what the subscription was', async () => {
      const f = await unpaidRenewal()
      await callVoid(f, { reason: 'Customer closed the business' })
      expect((await pool.query("SELECT actor,subject,reason,metadata FROM audit_events WHERE action='invoice.voided' AND subject=$1", [f.invoice])).rows).toEqual([{ actor: 'account:7', subject: f.invoice,
        reason: 'Customer closed the business', metadata: { outcome: 'rebill', subscription_id: f.subscription, order_id: f.order, renewal_id: f.renewal, previous_state: 'active', state: 'active' } }])
    })
    it('brings a past-due subscription back to active with its grace cleared', async () => {
      const f = await unpaidRenewal()
      await applyDunning(pool, { now: await afterDue(f, 0) })
      expect(await sub(f.subscription)).toMatchObject({ state: 'past_due' })
      const before = await sub(f.subscription)
      await callVoid(f)
      expect(await sub(f.subscription)).toMatchObject({ state: 'active', grace_ends_at: null, revision: before.revision + 1 })
      expect((await pool.query("SELECT metadata FROM audit_events WHERE action='invoice.voided' AND subject=$1", [f.invoice])).rows[0].metadata).toMatchObject({ previous_state: 'past_due', state: 'active' })
    })
    it('lifts a non-payment suspension: it clears when it left service and the workspace is told to resume', async () => {
      const f = await unpaidRenewal()
      await applyDunning(pool, { now: await afterDue(f, 0) })
      await applyDunning(pool, { now: await afterDue(f, 3) })
      const suspended = await sub(f.subscription)
      expect(suspended).toMatchObject({ state: 'suspended', manual_suspension: false })
      expect(suspended.left_service_at).not.toBeNull()
      const runner = vi.fn(async () => ({}))
      expect(await syncTenantStatus(pool, { runner })).toMatchObject({ pushed: [f.subscription] })
      expect(runner).toHaveBeenLastCalledWith({ tenant_id: f.tenant, status: 'suspended', suspension_reason: 'non_payment' })
      await callVoid(f)
      const resumed = await sub(f.subscription)
      expect(resumed).toMatchObject({ state: 'active', grace_ends_at: null, left_service_at: null, tenant_status_pushed: 'suspended' })
      expect(resumed.tenant_status_pending_since).not.toBeNull()
      expect(await syncTenantStatus(pool, { runner })).toMatchObject({ pushed: [f.subscription] })
      expect(runner).toHaveBeenLastCalledWith({ tenant_id: f.tenant, status: 'active', suspension_reason: null })
      expect((await sub(f.subscription)).tenant_status_pending_since).toBeNull()
    })
    it('does not lift a suspension the vendor ordered', async () => {
      const f = await unpaidRenewal()
      await suspendSubscription(pool, { subscription_id: f.subscription, reason: 'Vendor decision', actor: '7' })
      await callVoid(f)
      expect(await sub(f.subscription)).toMatchObject({ state: 'suspended', manual_suspension: true })
      expect((await view(f.invoice)).status).toBe('void')
    })
    it('keeps the subscription in dunning while another invoice is still overdue', async () => {
      const f = await unpaidRenewal()
      await applyDunning(pool, { now: await afterDue(f, 0) })
      // The customer's first invoice is also unpaid and overdue (fixture only: its status and date are immutable for the application).
      const c = await pool.connect()
      try { await c.query('BEGIN'); await c.query('SET LOCAL session_replication_role=replica'); await c.query("UPDATE invoices SET status='issued',paid_at=NULL,due_at=now()-interval '10 days' WHERE order_id=$1", [f.firstOrder]); await c.query('COMMIT') } finally { c.release() }
      const before = await sub(f.subscription)
      await callVoid(f)
      expect(await sub(f.subscription)).toMatchObject({ state: 'past_due', revision: before.revision })
    })
    it('answers a second call on a voided invoice with the current view and writes nothing more', async () => {
      const f = await unpaidRenewal()
      await callVoid(f)
      const once = await snapshot(f)
      expect(await callVoid(f)).toMatchObject({ id: f.invoice, status: 'void' })
      expect(await callVoid(f, { reason: 'A different reason' })).toMatchObject({ status: 'void' })
      expect(await snapshot(f)).toEqual(once)
    })
    it.each([['a deadlock', '40P01'], ['a serialization failure', '40001']])('answers %s the database aborted with the retryable 409 invoice_void_retry and changes nothing', async (_name, sqlstate) => {
      const f = await unpaidRenewal()
      const aborting = { connect: async () => {
        const c = await pool.connect(), original = c.query, query = c.query.bind(c) as (...args: unknown[]) => Promise<unknown>, release = c.release.bind(c)
        ;(c as any).release = () => { (c as any).query = original; (c as any).release = release; release() }
        ;(c as any).query = (sql: unknown, ...rest: unknown[]) => (/FROM orders WHERE id=\$1 FOR UPDATE/.test(String(sql)) ? Promise.reject(Object.assign(new Error('aborted'), { code: sqlstate })) : query(sql, ...rest))
        return c
      } } as unknown as Pool
      await expect(voidRenewalInvoice(aborting, { invoice_id: f.invoice, actor: 'account:7', reason: 'Customer will not pay', outcome: 'rebill' })).rejects.toMatchObject({ code: 'invoice_void_retry', status: 409 })
      expect((await pool.query('SELECT status FROM invoices WHERE id=$1', [f.invoice])).rows[0].status).toBe('issued')
      expect(await callVoid(f)).toMatchObject({ status: 'void' })
    })
    it('refuses an unknown invoice with 404, and a paid or non-renewal invoice with invoice_not_voidable', async () => {
      const f = await unpaidRenewal()
      await expect(callVoid({ ...f, invoice: randomUUID() })).rejects.toMatchObject({ status: 404, code: 'not_found' })
      const paid = (await pool.query("SELECT id FROM invoices WHERE subscription_id=$1 AND kind='initial'", [f.subscription])).rows[0].id
      await expect(callVoid({ ...f, invoice: paid })).rejects.toMatchObject({ status: 409, code: 'invoice_not_voidable' })
    })
    describe('refusals change nothing', () => {
      const refused: [string, string, (f: Fixture) => Promise<unknown>][] = [
        ['a live payment attempt', 'payment_reconciliation_required', f => attempt(f, 'pending')],
        ['a created payment attempt', 'payment_reconciliation_required', f => attempt(f, 'created')],
        ['a succeeded attempt on the order', 'payment_reconciliation_required', f => attempt(f, 'succeeded')],
        ['a customer bank-transfer claim', 'transfer_claimed', f => pool.query("INSERT INTO bank_transfer_claims(invoice_id,value_date) VALUES($1,'2026-10-02')", [f.invoice])],
        ['a renewal paid and still being applied', 'renewal_in_progress', f => pool.query("UPDATE orders SET payment_state='paid',fulfillment_state='queued' WHERE id=$1", [f.order])],
        ['a free-base lock in flight', 'lock_pending', async f => pool.query(`INSERT INTO free_base_locks(subscription_id,pre_lock_revision_id,period_start,armed_at,cause,next_attempt_at)
          VALUES($1,(SELECT applied_revision_id FROM subscriptions WHERE id=$1),'2026-10-01',now(),'cancelled',now())`, [f.subscription])],
        ['a workspace being deleted', 'tenant_retiring', f => pool.query(`INSERT INTO tenant_deletion_requests(id,customer_id,state,requested_at,requested_by,confirmed_at,confirmed_by,due_at,due_marked_at,hold_until,deleting_at,plan,plan_digest,renewal_outcome,renewal_refusal)
          VALUES($1,$2,'deleting',now(),'t',now(),'t',now(),now(),now(),now(),'{}'::jsonb,$3,'not_cancellable','no_subscription')`, [randomUUID(), f.customer, 'a'.repeat(64)])],
      ]
      it.each(refused)('%s', async (_name, code, arrange) => {
        const f = await unpaidRenewal()
        await arrange(f)
        const before = await snapshot(f)
        await expect(callVoid(f)).rejects.toMatchObject({ status: 409, code })
        expect(await snapshot(f)).toEqual(before)
      })
    })
    it('lets the next renewal run issue a new invoice for the same period with a new due date', async () => {
      const f = await unpaidRenewal()
      const oldDue = await dueAt(f)
      await callVoid(f)
      const later = new Date('2026-10-05T08:00:00Z')
      await renew(later)
      const rows = (await pool.query(`SELECT r.status,r.period_start::text AS start,i.status AS invoice_status,i.due_at,o.cancelled FROM renewals r JOIN invoices i ON i.id=r.invoice_id
        JOIN orders o ON o.id=r.order_id WHERE r.subscription_id=$1 ORDER BY r.created_at`, [f.subscription])).rows
      expect(rows.map(r => [r.start, r.status, r.invoice_status, r.cancelled])).toEqual([['2026-10-01', 'superseded', 'void', true], ['2026-10-01', 'invoiced', 'issued', false]])
      expect(new Date(rows[1].due_at).getTime()).toBeGreaterThanOrEqual(oldDue.getTime())
      expect(await renew(later)).toEqual([]) // and only one
    })
    it('stops card charges and dunning for the voided invoice', async () => {
      const f = await unpaidRenewal()
      const adapter = new SimulatorAdapter().addToken('tok_void')
      const charge = vi.spyOn(adapter, 'chargeToken')
      await seedPaymentMethod(pool, f.customer, 'tok_void')
      await pool.query('UPDATE subscriptions SET auto_renew_enabled=true,auto_renew_consent_at=now(),revision=revision+1 WHERE id=$1', [f.subscription])
      await callVoid(f)
      expect(await chargeSavedCards(pool, { now: await afterDue(f, 0), adapter, returnOrigin: origin })).toEqual({ charged: 0, failed: 0 })
      expect(charge).not.toHaveBeenCalled()
      expect(await applyDunning(pool, { now: await afterDue(f, 30) })).toEqual([])
      expect(await sub(f.subscription)).toMatchObject({ state: 'active' })
    })
    it('refunds a capture that reaches the provider after the void', async () => {
      const f = await unpaidRenewal()
      const adapter = new SimulatorAdapter()
      const opened = await createPaymentAttempt(pool, { order_id: f.order, customer_id: f.customer, adapter, returnOrigin: origin })
      // The attempt was closed on our side (timeout, hold expired) before the vendor voided; the provider captures it afterwards.
      await pool.query("UPDATE payment_attempts SET status='canceled' WHERE id=$1", [opened.id])
      await callVoid(f)
      adapter.settle(opened.provider_ref!, 'succeeded')
      await handleProviderEvent(pool, { provider: 'simulator', rawBody: adapter.webhookBody(opened.provider_ref!), headers: {}, adapter })
      expect(await orderRow(f.order)).toMatchObject({ cancelled: true, payment_state: 'refund_pending' })
      expect((await pool.query("SELECT status FROM invoices WHERE id=$1", [f.invoice])).rows[0].status).toBe('void')
    })
  })

  describe('voiding with the end outcome', () => {
    const endVoid = (f: Fixture, over: Record<string, unknown> = {}) => callVoid(f, { outcome: 'end', ...over })
    const lockRow = async (id: string) => (await pool.query('SELECT *,period_start::text AS start FROM free_base_locks WHERE subscription_id=$1', [id])).rows[0]
    const outbox = async (id: string, kind: string) => (await pool.query('SELECT payload,status FROM commercial_outbox WHERE aggregate_id=$1 AND kind=$2 ORDER BY created_at', [id, kind])).rows
    async function freshUsage(f: Fixture, at: Date) {
      const numeric = Object.entries((await pool.query('SELECT snapshot FROM subscription_revisions WHERE id=(SELECT applied_revision_id FROM subscriptions WHERE id=$1)', [f.subscription])).rows[0].snapshot.entitlement.features)
        .filter(([, value]) => typeof value === 'number').map(([key]) => key)
      await recordUsage(pool, { tenant_id: f.tenant, observed_at: at, source: 'void', metrics: Object.fromEntries(numeric.map(key => [key, 0])), limit_gates: Object.fromEntries(numeric.map(key => [key, []])) })
    }
    const okRunner = (at: Date) => async ({ job }: { job: any }) => ({ order_id: job.authority.order_id, tenant_id: job.binding.database, database: job.binding.database,
      target_revision_id: job.authority.target_revision_id, observed_entitlement_digest: job.authority.entitlement.digest, observed_at: at.toISOString(), branch_bindings: [], modules_installed: [] })
    /** The scheduler's free-base pass: orders the lock, delivers it to the workspace as the shared worker would, and settles it. */
    async function runLock(f: Fixture) {
      const adapter = new SimulatorAdapter(), dropAt = new Date(Date.now() + 60_000)
      await freshUsage(f, dropAt)
      await processFreeBaseLocks(pool, { now: dropAt, adapter, subscription_id: f.subscription })
      const order = (await pool.query("SELECT id FROM orders WHERE subscription_id=$1 AND idempotency_key LIKE $2", [f.subscription, `free-base-lock:${f.subscription}:%`])).rows[0]
      for (let pass = 0; pass < 20; pass++) {
        await processFulfillmentOutbox(pool, { limit: 100 })
        if ((await pool.query('SELECT 1 FROM fulfillment_effects WHERE order_id=$1 AND job_id IS NOT NULL', [order.id])).rowCount) break
      }
      const job = (await pool.query('SELECT job_id FROM fulfillment_effects WHERE order_id=$1', [order.id])).rows[0].job_id
      expect(await runSubscriptionReconfigure(pool, job, okRunner(dropAt))).toMatchObject({ state: 'verified' })
      await processFreeBaseLocks(pool, { now: dropAt, adapter, subscription_id: f.subscription })
    }
    /** The first invoice is also unpaid and overdue (fixture only: its status and date are immutable for the application). */
    async function firstInvoiceOverdue(f: Fixture) {
      const c = await pool.connect()
      try { await c.query('BEGIN'); await c.query('SET LOCAL session_replication_role=replica'); await c.query("UPDATE invoices SET status='issued',paid_at=NULL,due_at=now()-interval '10 days' WHERE order_id=$1", [f.firstOrder]); await c.query('COMMIT') } finally { c.release() }
    }

    it('records a vendor cancellation and arms the cancellation lock for the voided period, with no new renewal', async () => {
      const f = await unpaidRenewal()
      await endVoid(f, { reason: 'Customer left the company' })
      expect(await sub(f.subscription)).toMatchObject({ state: 'active', cancel_requested_by: 'vendor', cancel_reason: 'Customer left the company' })
      expect(await lockRow(f.subscription)).toMatchObject({ state: 'pending', cause: 'cancelled', start: '2026-10-01' })
      expect((await pool.query("SELECT actor,reason FROM audit_events WHERE action='subscription.cancel_requested' AND subject=$1", [f.subscription])).rows).toEqual([{ actor: 'account:7', reason: 'Customer left the company' }])
      expect((await pool.query("SELECT metadata FROM audit_events WHERE action='invoice.voided' AND subject=$1", [f.invoice])).rows[0].metadata).toMatchObject({ outcome: 'end', state: 'active' })
      expect(await renew(new Date('2026-10-05T08:00:00Z'))).toEqual([])
      expect((await pool.query('SELECT count(*)::int AS n FROM renewals WHERE subscription_id=$1 AND status<>$2', [f.subscription, 'superseded'])).rows[0].n).toBe(0)
    })
    it('drops the workspace to the free base on the next lock run and tells the customer once, with the notice of the cancelled cause', async () => {
      const f = await unpaidRenewal()
      await endVoid(f)
      await runLock(f)
      expect(await lockRow(f.subscription)).toMatchObject({ state: 'done', cause: 'cancelled' })
      const dropped = await sub(f.subscription)
      expect(dropped).toMatchObject({ state: 'active', cancel_requested_at: null })
      expect(dropped.renewal_at).not.toEqual(new Date('2026-10-01'))
      expect(await outbox(f.subscription, 'free_base.locked')).toEqual([{ status: 'pending', payload: expect.objectContaining({ cause: 'cancelled' }) }])
      // The "cancelled, ends on a date" notice is never queued: the drop is immediate, so only the drop notice says it.
      expect((await outbox(f.subscription, 'cancellation.notice')).map(row => row.payload.type)).toEqual([])
      expect(await renew(new Date('2026-10-05T08:00:00Z'))).toEqual([])
    })
    it('takes a subscription dunning suspended a moment before: it is active again at once and the lock settles', async () => {
      const f = await unpaidRenewal()
      await applyDunning(pool, { now: await afterDue(f, 0) }); await applyDunning(pool, { now: await afterDue(f, 3) })
      expect(await sub(f.subscription)).toMatchObject({ state: 'suspended' })
      await endVoid(f)
      expect(await sub(f.subscription)).toMatchObject({ state: 'active', left_service_at: null })
      await runLock(f)
      expect(await lockRow(f.subscription)).toMatchObject({ state: 'done' })
      expect(await sub(f.subscription)).toMatchObject({ state: 'active', cancel_requested_at: null })
    })
    it('arms the lock even when another invoice keeps the subscription suspended, and the lock run settles it to active', async () => {
      const f = await unpaidRenewal()
      await applyDunning(pool, { now: await afterDue(f, 0) }); await applyDunning(pool, { now: await afterDue(f, 3) })
      await firstInvoiceOverdue(f)
      await endVoid(f)
      expect(await sub(f.subscription)).toMatchObject({ state: 'suspended', manual_suspension: false })
      expect(await lockRow(f.subscription)).toMatchObject({ state: 'pending', cause: 'cancelled' })
      expect(await applyDunning(pool, { now: await afterDue(f, 30) })).toEqual([]) // the armed lock holds dunning
      await runLock(f)
      expect(await sub(f.subscription)).toMatchObject({ state: 'active', cancel_requested_at: null })
    })
    it('keeps an earlier customer cancellation request as it was', async () => {
      const f = await unpaidRenewal()
      await pool.query("UPDATE subscriptions SET cancel_requested_at='2026-09-20T09:00:00Z',cancel_requested_by='customer',revision=revision+1 WHERE id=$1", [f.subscription])
      await endVoid(f)
      expect(await sub(f.subscription)).toMatchObject({ cancel_requested_by: 'customer' })
      expect(await lockRow(f.subscription)).toMatchObject({ state: 'pending', cause: 'cancelled' })
      expect((await pool.query("SELECT count(*)::int AS n FROM audit_events WHERE action='subscription.cancel_requested' AND subject=$1", [f.subscription])).rows[0].n).toBe(0)
    })
    it('is refused while the vendor has the subscription suspended, and while a change is pending, and changes nothing', async () => {
      const f = await unpaidRenewal()
      await suspendSubscription(pool, { subscription_id: f.subscription, reason: 'Vendor decision', actor: '7' })
      let before = await snapshot(f)
      await expect(endVoid(f)).rejects.toMatchObject({ status: 409, code: 'subscription_suspended' })
      expect(await snapshot(f)).toEqual(before)
      expect(await lockRow(f.subscription)).toBeUndefined()
      const g = await unpaidRenewal()
      await pool.query('UPDATE subscriptions SET target_revision_id=applied_revision_id,revision=revision+1 WHERE id=$1', [g.subscription])
      before = await snapshot(g)
      await expect(endVoid(g)).rejects.toMatchObject({ status: 409, code: 'subscription_change_pending' })
      expect(await snapshot(g)).toEqual(before)
      expect(await lockRow(g.subscription)).toBeUndefined()
    })
  })

  describe('the void route', () => {
    const BOTH = ['vendor.read', 'vendor.billing.manage', 'vendor.subscriptions.manage']
    const post = async (id: string, body: unknown, over: { capabilities?: string[]; stepUpFresh?: boolean } = {}) => {
      try {
        const pathname = `/v1/commercial/invoices/${id}/void`
        const r = await routesB(pool, { method: 'POST', pathname, raw: JSON.stringify(body), issuer: 'commercial-test', actor: 7,
          capabilities: (over.capabilities ?? BOTH) as any[], stepUpFresh: over.stepUpFresh ?? true }, new URL(pathname, 'http://localhost'))
        return { status: r!.status, body: r!.data as any }
      } catch (error) {
        if (error instanceof CommercialHttpError) return { status: error.status, body: { code: error.code } }
        throw error
      }
    }
    const valid = { reason: 'Customer will not pay', outcome: 'rebill' }

    it('voids the invoice for an operator who holds both grants and a fresh step-up, and answers the invoice', async () => {
      const f = await unpaidRenewal()
      const res = await post(f.invoice, valid)
      expect(res).toMatchObject({ status: 200, body: { id: f.invoice, status: 'void', voidable: false } })
      expect((await pool.query("SELECT actor FROM audit_events WHERE action='invoice.voided' AND subject=$1", [f.invoice])).rows).toEqual([{ actor: 'account:7' }])
      expect(await post(f.invoice, valid)).toMatchObject({ status: 200, body: { status: 'void' } })
    })
    it.each([['billing only', ['vendor.read', 'vendor.billing.manage']], ['subscriptions only', ['vendor.read', 'vendor.subscriptions.manage']], ['read only', ['vendor.read']]])('answers 403 forbidden with %s and changes nothing', async (_name, capabilities) => {
      const f = await unpaidRenewal()
      expect(await post(f.invoice, valid, { capabilities })).toMatchObject({ status: 403, body: { code: 'forbidden' } })
      expect((await pool.query('SELECT status FROM invoices WHERE id=$1', [f.invoice])).rows[0].status).toBe('issued')
    })
    it('answers 403 step_up_required without a fresh step-up and changes nothing', async () => {
      const f = await unpaidRenewal()
      expect(await post(f.invoice, valid, { stepUpFresh: false })).toMatchObject({ status: 403, body: { code: 'step_up_required' } })
      expect((await pool.query('SELECT status FROM invoices WHERE id=$1', [f.invoice])).rows[0].status).toBe('issued')
    })
    it('answers 404 for an unknown or malformed invoice id', async () => {
      expect(await post(randomUUID(), valid)).toMatchObject({ status: 404, body: { code: 'not_found' } })
      expect(await post('not-a-uuid', valid)).toMatchObject({ status: 404, body: { code: 'not_found' } })
    })
    it.each([['a short reason', { reason: 'ab', outcome: 'end' }], ['a reason over 1000 characters', { reason: 'x'.repeat(1001), outcome: 'end' }], ['no reason', { outcome: 'end' }],
      ['no outcome', { reason: 'fine reason' }], ['the waive outcome', { reason: 'fine reason', outcome: 'waive' }], ['an unknown field', { reason: 'fine reason', outcome: 'end', extra: 1 }]])('answers 422 for %s', async (_name, body) => {
      const f = await unpaidRenewal()
      expect(await post(f.invoice, body)).toMatchObject({ status: 422, body: { code: 'invalid' } })
      expect((await pool.query('SELECT status FROM invoices WHERE id=$1', [f.invoice])).rows[0].status).toBe('issued')
    })
    it('answers a blocked invoice with its 409 code', async () => {
      const f = await unpaidRenewal()
      await pool.query("INSERT INTO bank_transfer_claims(invoice_id,value_date) VALUES($1,'2026-10-02')", [f.invoice])
      expect(await post(f.invoice, valid)).toMatchObject({ status: 409, body: { code: 'transfer_claimed' } })
    })
    it('takes only POST', async () => {
      const f = await unpaidRenewal()
      for (const method of ['GET', 'PUT', 'PATCH', 'DELETE']) {
        const pathname = `/v1/commercial/invoices/${f.invoice}/void`
        await expect(routesB(pool, { method, pathname, raw: '', issuer: 'commercial-test', actor: 7, capabilities: BOTH as any[], stepUpFresh: true }, new URL(pathname, 'http://localhost'))).resolves.toBeNull()
      }
    })
  })
})
