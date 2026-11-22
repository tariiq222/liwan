import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { Pool } from 'pg'
import { setup, client, money, monthly, url } from './commercial-helpers.js'
import { acceptQuote } from '../commercial/orders.js'
import { createQuoteForCustomer } from '../commercial/quotes.js'
import { generateRenewals } from '../commercial/renewals.js'
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
    const customer = randomUUID()
    await pool.query('INSERT INTO customers(id,name,admin_name,admin_login) VALUES($1,$2,$3,$4)', [customer, 'Void customer', 'Manager', `${customer}@example.test`])
    const quote = await createQuoteForCustomer(pool, { customer_id: customer, request: { kind: 'new', plan_revision_id: plan.id, bundle_revision_ids: [], cadence: monthly, requested_extra_branches: 0, requested_users: 1, requested_storage_mb: 0 } })
    const { order } = await acceptQuote(pool, { quote_id: quote.id, expected_subscription_revision: 0, idempotency_key: randomUUID() }, vendor)
    await pool.query("UPDATE orders SET payment_state='paid',fulfillment_state='applied' WHERE id=$1", [order.id])
    await pool.query("UPDATE invoices SET status='paid',paid_at=now() WHERE order_id=$1", [order.id])
    await pool.query("UPDATE subscriptions SET applied_revision_id=target_revision_id,target_revision_id=NULL,state='active',renewal_at='2026-10-01',revision=revision+1 WHERE id=$1", [order.subscription_id])
    await renew()
    const row = (await pool.query(`SELECT r.id AS renewal,r.order_id,r.invoice_id FROM renewals r WHERE r.subscription_id=$1`, [order.subscription_id])).rows[0]
    return { customer, subscription: order.subscription_id as string, renewal: row.renewal as string, order: row.order_id as string, invoice: row.invoice_id as string, firstInvoice: order.id as string }
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
})
