import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { Pool } from 'pg'
import type { Principal } from '@liwan/commercial-contracts'
import { client, money, monthly, setup, url } from './commercial-helpers.js'
import { startTrial } from '../commercial/trial.js'
import { expireTrials } from '../commercial/trial-expiry.js'
import { processTrialLapses } from '../commercial/trial-lapse.js'
import { createBranchQuote } from '../commercial/customer-http.js'
import { generateRenewals } from '../commercial/renewals.js'
import { applyReceipt, processFulfillmentOutbox } from '../commercial/fulfillment.js'
import { createQuoteForCustomer } from '../commercial/quotes.js'
import { acceptQuote } from '../commercial/orders.js'
import { recordUsage } from '../commercial/usage.js'
import { getSubscription } from '../commercial/subscriptions.js'
import { SimulatorAdapter } from '../commercial/payment-simulator.js'
import { fixedReturnOrigin } from '../commercial/return-origin.js'
import { applyDunning } from '../commercial/renewals.js'
import { attention } from '../commercial/attention.js'
import { syncTenantStatus } from '../commercial/suspension.js'

/**
 * The invariants of the free base after a trial (issue 491, design note section D), each as a state-level test. The scenario
 * tests of `commercial-free-base.test.ts` cover the individual flows; this file is the checklist of what must stay true.
 */
const POLICY = '6f1c3d8e-0000-4000-8000-000000000001'
const PAID_KEYS = ['pmo.enabled', 'pmo.change_control', 'pmo.baselines', 'pmo.evm']
const day = 86_400_000
const suite = url ? describe : describe.skip
suite('free base invariants (issue 491)', () => {
  const pool = new Pool({ connectionString: url, max: 6 })
  const api = client(pool)
  const reason = 'Free base invariants'
  const now = new Date('2026-11-20T09:00:00Z')
  const at = (hours: number) => new Date(now.getTime() + hours * 3_600_000)
  const origin = fixedReturnOrigin('https://liwan.test')
  const adapter = new SimulatorAdapter()
  let plans: { free: any; priced: any }, bundle: any, vendor: Principal

  beforeAll(async () => {
    const { version } = await setup(pool)
    const release = (await api('POST', '/catalog/releases', { catalog_version: version, reason })).body
    const app = release.applications.find((a: any) => a.features.some((f: any) => f.key === 'projects.max_projects'))
    const b = await api('POST', '/bundles', { name: `Projects ${randomUUID()}`, description: 'Projects', audience: { kind: 'public' }, catalog_release_id: release.id,
      selections: [{ app_id: app.id, feature_keys: ['pmo.enabled'] }], domain_limits: { 'projects.max_projects': 10 }, prices: [{ cadence: monthly, amount: money(19900) }] })
    const bv = await api('POST', `/bundles/${b.body.id}/validate`, { edit_revision: 1, reason })
    bundle = (await api('POST', `/bundles/${b.body.id}/publish`, { edit_revision: bv.body.edit_revision, reason })).body
    const plan = async (branchMinor: number) => {
      const p = await api('POST', '/plans', { name: `Invariants ${randomUUID()}`, audience: { kind: 'public' }, term_months: 12, currency: 'SAR',
        prices: [{ cadence: monthly, amount: money(0) }], platform_limits: {}, included_bundle_revision_ids: [], optional_bundle_revision_ids: [bundle.id],
        included_extra_branches: 1, extra_branch_prices: [{ cadence: monthly, amount: money(branchMinor) }], extra_branches_limit: null,
        included_users: 3, included_storage_mb: 20480, storage_step_mb: 10240, storage_step_threshold_mb: 102400, storage_large_step_mb: 102400,
        user_prices: [{ cadence: monthly, amount: money(2900) }], storage_prices: [{ cadence: monthly, amount: money(100) }],
        policy_revision_id: POLICY, trial_days: 14, grace_days: 7, auto_suspend: true, auto_renew_allowed: true })
      expect(p.status, JSON.stringify(p.body)).toBe(201)
      const pv = await api('POST', `/plans/${p.body.id}/validate`, { edit_revision: 1, reason })
      return (await api('POST', `/plans/${p.body.id}/publish`, { edit_revision: pv.body.edit_revision, reason })).body
    }
    plans = { free: await plan(0), priced: await plan(5000) }
    vendor = { actor_id: '7', kind: 'vendor', customer_id: null, tenant_id: null, capabilities: ['vendor.subscriptions.manage', 'vendor.pricing.manage'] } as unknown as Principal
  })
  afterAll(async () => { await pool.end() })

  const request = (plan = plans.free, over: Record<string, unknown> = {}) => ({ kind: 'new' as const, plan_revision_id: plan.id, bundle_revision_ids: [bundle.id], cadence: monthly,
    requested_extra_branches: 0, requested_users: 3, requested_storage_mb: 20480, ...over })

  /** A customer whose trial of the paid application ended a day before `now`, with the trial order applied. */
  async function endedTrial(over: Record<string, unknown> = {}, plan = plans.free) {
    const customer = randomUUID(), tenant = randomUUID()
    const slug = `t${tenant.replaceAll('-', '')}`
    await pool.query("INSERT INTO tenants(id,name,commercial_mode,hosting_model,inventory_target,operations_enabled) VALUES($1,'Invariants','saas','shared_managed',$2,true)", [tenant, slug])
    await pool.query('INSERT INTO customers(id,name,tenant_id,admin_name,admin_login) VALUES($1,$2,$3,$4,$5)', [customer, 'Invariants', tenant, 'Manager', `${customer}@example.test`])
    await pool.query('INSERT INTO shared_registry_bindings(control_tenant_id,tenant_id,host,database_name,filestore,enabled,registry_revision) VALUES($1,$2,$3,$4,$4,true,1)', [tenant, slug, `${slug}.test`, `liwan_scratch_${slug.slice(1)}`])
    const principal = { actor_id: '7', kind: 'customer', customer_id: customer, tenant_id: tenant, capabilities: ['subscription.manage'] } as unknown as Principal
    await startTrial(pool, { customer_id: customer, request: request(plan, over), principal, now: new Date(now.getTime() - 15 * day) })
    await pool.query('UPDATE subscriptions SET applied_revision_id=target_revision_id,target_revision_id=NULL,revision=revision+1 WHERE customer_id=$1', [customer])
    await pool.query("UPDATE orders SET fulfillment_state='applied' WHERE customer_id=$1", [customer])
    await pool.query("UPDATE commercial_outbox SET status='done' WHERE kind='fulfillment.enqueue' AND aggregate_id IN (SELECT id::text FROM orders WHERE customer_id=$1)", [customer])
    return { customer, tenant, subscription: (await getSubscription(pool, customer)).id, plan }
  }
  type F = Awaited<ReturnType<typeof endedTrial>>
  const row = async (id: string) => (await pool.query('SELECT * FROM subscriptions WHERE id=$1', [id])).rows[0]
  const lapseRow = async (id: string) => (await pool.query('SELECT * FROM trial_lapses WHERE subscription_id=$1', [id])).rows[0]
  const lapseOrders = async (id: string) => (await pool.query("SELECT * FROM orders WHERE subscription_id=$1 AND idempotency_key LIKE $2 ORDER BY created_at,id", [id, `trial-lapse:${id}:%`])).rows
  const applied = async (id: string) => (await pool.query('SELECT snapshot FROM subscription_revisions WHERE id=(SELECT applied_revision_id FROM subscriptions WHERE id=$1)', [id])).rows[0].snapshot
  async function pushed(tenant: string, orderId: string) {
    for (let pass = 0; pass < 20; pass++) {
      await processFulfillmentOutbox(pool, { limit: 100 })
      if ((await pool.query('SELECT 1 FROM fulfillment_effects WHERE order_id=$1 AND job_id IS NOT NULL', [orderId])).rowCount) break
    }
    const job = (await pool.query("SELECT payload FROM shared_jobs WHERE control_tenant_id=$1 AND payload->'authority'->>'order_id'=$2", [tenant, orderId])).rows[0].payload
    const receipt = { order_id: orderId, tenant_id: job.binding.database, database: job.binding.database, target_revision_id: job.authority.target_revision_id,
      observed_entitlement_digest: job.authority.entitlement.digest, observed_at: new Date().toISOString(), branch_bindings: [], modules_installed: [] }
    return { job, receipt }
  }
  const applyOrder = async (f: { tenant: string }, orderId: string) => { const p = await pushed(f.tenant, orderId); await applyReceipt(pool, { order_id: orderId, receipt: p.receipt }); return p.job }
  /** The lock: lapse, first order, applied, and the pass that settles it. */
  async function locked(f: F, when = now) {
    await expireTrials(pool, { now: when, adapter, returnOrigin: origin, subscription_id: f.subscription })
    await processTrialLapses(pool, { now: when, adapter, subscription_id: f.subscription })
    const order = (await lapseOrders(f.subscription)).at(-1)
    await applyOrder(f, order.id)
    await processTrialLapses(pool, { now: when, adapter, subscription_id: f.subscription })
    return order
  }
  async function freshUsage(f: F, when: Date, over: Record<string, number> = {}) {
    const numeric = Object.entries((await applied(f.subscription)).entitlement.features).filter(([, v]) => typeof v === 'number').map(([k]) => k)
    await recordUsage(pool, { tenant_id: f.tenant, observed_at: when, source: 'free-base-invariants',
      metrics: { ...Object.fromEntries(numeric.map(k => [k, 0])), ...over }, limit_gates: Object.fromEntries(numeric.map(k => [k, k === 'projects.max_projects' ? ['pmo.enabled'] : []])) })
  }
  const quoteChange = async (f: F, over: Record<string, unknown>, when: Date, bundles: string[] = []) => {
    const sub = await getSubscription(pool, f.customer)
    return createQuoteForCustomer(pool, { customer_id: f.customer, request: { ...request(f.plan), bundle_revision_ids: bundles, kind: 'change', subscription_id: sub.id, expected_subscription_revision: sub.revision, ...over } }, when)
  }
  const accept = async (f: F, quote: { id: string }) => {
    const sub = await getSubscription(pool, f.customer)
    return (await acceptQuote(pool, { quote_id: quote.id, expected_subscription_revision: sub.revision, idempotency_key: randomUUID() }, vendor)).order
  }
  const payAndApply = async (f: F, order: { id: string; target_revision_id: string }) => {
    await pool.query("UPDATE orders SET payment_state='paid' WHERE id=$1", [order.id])
    await pool.query("INSERT INTO commercial_outbox(id,kind,aggregate_id,dedupe_key,payload) VALUES($1,'fulfillment.enqueue',$2,$3,$4) ON CONFLICT DO NOTHING", [randomUUID(), order.id, order.target_revision_id, JSON.stringify({ order_id: order.id })])
    return applyOrder(f, order.id)
  }

  describe('I11: a held quantity is never lowered automatically (owner decision 1)', () => {
    it('usage falls and many ticks pass: no lowering order, the lapse is done, the quantity stays', async () => {
      const f = await endedTrial({ requested_users: 10 })
      await locked(f)
      expect(await lapseRow(f.subscription)).toMatchObject({ state: 'done' })
      expect((await applied(f.subscription)).held_ceilings).toMatchObject({ 'users.limit': { held: 10, target: 3 } })
      for (const hours of [2, 30, 60, 100]) {
        await freshUsage(f, at(hours), { 'users.limit': 1 })
        await processTrialLapses(pool, { now: at(hours), adapter, subscription_id: f.subscription })
      }
      expect(await lapseOrders(f.subscription)).toHaveLength(1)
      expect((await applied(f.subscription)).entitlement.features['users.limit']).toBe(10)
    })
    it('a change that does not name the quantity carries it, still without any lowering (a ceiling on a paid-base plan is simply carried)', async () => {
      const f = await endedTrial({ requested_users: 4 })
      await locked(f)
      const branch = randomUUID()
      await pool.query("INSERT INTO commercial_branches(id,subscription_id,tenant_id,name,kind,billing,state) VALUES($1,$2,$3,'b','extra','paid','active')", [branch, f.subscription, f.tenant])
      vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(now)
      try {
        const quote = await createBranchQuote(pool, f.customer, JSON.stringify({ archive: [branch] }))
        const order = await accept(f, quote)
        await pool.query('UPDATE subscriptions SET applied_revision_id=target_revision_id,target_revision_id=NULL,revision=revision+1 WHERE id=$1', [f.subscription])
        await pool.query("UPDATE orders SET fulfillment_state='applied' WHERE id=$1", [order.id])
      } finally { vi.useRealTimers() }
      await freshUsage(f, at(40), { 'users.limit': 1 })
      await processTrialLapses(pool, { now: at(41), adapter, subscription_id: f.subscription })
      const kept = await applied(f.subscription)
      expect(kept.entitlement.features['users.limit']).toBe(4)
      expect(kept.held_ceilings).toMatchObject({ 'users.limit': { held: 4, target: 3 } })
      expect(await lapseOrders(f.subscription)).toHaveLength(1)
    })
  })

  describe('I9: no order built against the trial applies after the trial end without being reconciled', () => {
    it('D1: a zero-due change accepted during the trial that applies after the lapse still gets the lock', async () => {
      const f = await endedTrial()
      const quote = await quoteChange(f, {}, new Date(now.getTime() - 5 * day), [bundle.id])
      expect(quote.due_now.minor).toBe(0)
      const order = await accept(f, quote)
      expect(order.payment_state).toBe('not_required')
      await expireTrials(pool, { now, adapter, returnOrigin: origin, subscription_id: f.subscription })
      await processTrialLapses(pool, { now, adapter, subscription_id: f.subscription })
      await applyOrder(f, order.id)
      await processTrialLapses(pool, { now: at(1), adapter, subscription_id: f.subscription })
      expect(await lapseRow(f.subscription)).not.toMatchObject({ state: 'superseded' })
      const lock = (await lapseOrders(f.subscription)).at(-1)
      expect(lock, 'the lock order is issued against the newly applied revision').toBeTruthy()
      const job = await applyOrder(f, lock.id)
      for (const key of PAID_KEYS) expect(job.authority.entitlement.features[key], key).toBe(false)
      await processTrialLapses(pool, { now: at(2), adapter, subscription_id: f.subscription })
      expect(await lapseRow(f.subscription)).toMatchObject({ state: 'done' })
    })
    it('C: a paid order in fulfillment at the boundary is waited for, then the customer is a converted paid subscriber', async () => {
      const f = await endedTrial()
      const quote = await quoteChange(f, { requested_users: 4 }, new Date(now.getTime() - 5 * day), [bundle.id])
      expect(quote.due_now.minor).toBeGreaterThan(0)
      const order = await accept(f, quote)
      await pool.query("UPDATE orders SET payment_state='paid',fulfillment_state='queued' WHERE id=$1", [order.id])
      await pool.query("INSERT INTO commercial_outbox(id,kind,aggregate_id,dedupe_key,payload) VALUES($1,'fulfillment.enqueue',$2,$3,$4) ON CONFLICT DO NOTHING", [randomUUID(), order.id, order.target_revision_id, JSON.stringify({ order_id: order.id })])
      await expireTrials(pool, { now, adapter, returnOrigin: origin, subscription_id: f.subscription })
      await processTrialLapses(pool, { now, adapter, subscription_id: f.subscription })
      expect(await lapseOrders(f.subscription), 'nothing is locked while it is in fulfillment').toHaveLength(0)
      await applyOrder(f, order.id)
      await processTrialLapses(pool, { now: at(1), adapter, subscription_id: f.subscription })
      expect(await lapseOrders(f.subscription), 'and nothing the customer paid for is locked afterwards').toHaveLength(0)
      for (const key of PAID_KEYS) expect((await applied(f.subscription)).entitlement.features[key], key).toBe(true)
      expect(await row(f.subscription)).toMatchObject({ state: 'past_due' })
      // The first invoice is for what the customer bought, dated from the trial end.
      const generated = await generateRenewals(pool, { now: at(2), adapter, returnOrigin: origin, subscription_id: f.subscription })
      expect(generated).toHaveLength(1)
      expect(generated[0]!.due_now.minor).toBeGreaterThan(19900)
    })
    it('B.4: once the trial end date has passed and the lapse has not run, no new order is accepted', async () => {
      const f = await endedTrial()
      vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date(now.getTime() - 5 * day))
      const quote = await quoteChange(f, { requested_users: 4 }, new Date(now.getTime() - 5 * day), [bundle.id])
      vi.setSystemTime(now)
      try {
        const sub = await getSubscription(pool, f.customer)
        await expect(acceptQuote(pool, { quote_id: quote.id, expected_subscription_revision: sub.revision, idempotency_key: randomUUID() }, vendor)).rejects.toMatchObject({ code: 'trial_ending', status: 409 })
      } finally { vi.useRealTimers() }
    })
  })

  describe('I15: branch pricing follows the kept slots (D2)', () => {
    it('archive-only keeps the remaining kept branches free with a non-zero branch price; buying one prices every active branch', async () => {
      const f = await endedTrial({}, plans.priced)
      const names = ['one', 'two', 'three']
      const ids: string[] = []
      for (const name of names) { const id = randomUUID(); ids.push(id); await pool.query("INSERT INTO commercial_branches(id,subscription_id,tenant_id,name,kind,billing,state) VALUES($1,$2,$3,$4,'extra','paid','active')", [id, f.subscription, f.tenant, name]) }
      await locked(f)
      vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(now)
      try {
        const archive = await createBranchQuote(pool, f.customer, JSON.stringify({ archive: [ids[0]] }))
        expect(archive.due_now.minor, 'archiving never charges for the branches that stay').toBe(0)
        const add = await createBranchQuote(pool, f.customer, JSON.stringify({ add: [{ name: 'fourth' }] }))
        expect(add.due_now.minor).toBeGreaterThan(0)
        expect(add.lines.filter(l => l.kind === 'branch').map(l => l.quantity)).toContain(3)
      } finally { vi.useRealTimers() }
    })
  })

  describe('I10 and I14: the lock keeps every numeric limit and clears the hard expiry', () => {
    it('the lock order carries the trial limits unchanged, closes the paid keys, and every push of the lapse has no expiry', async () => {
      const f = await endedTrial({ requested_users: 10, requested_storage_mb: 30720 })
      const trial = (await applied(f.subscription)).entitlement.features as Record<string, unknown>
      await expireTrials(pool, { now, adapter, returnOrigin: origin, subscription_id: f.subscription })
      await processTrialLapses(pool, { now, adapter, subscription_id: f.subscription })
      const order = (await lapseOrders(f.subscription)).at(-1)
      const job = await applyOrder(f, order.id)
      const lock = job.authority.entitlement.features as Record<string, unknown>
      for (const [key, value] of Object.entries(trial)) if (typeof value === 'number') expect(lock[key], key).toBe(value)
      for (const key of PAID_KEYS) expect(lock[key], key).toBe(false)
      const expiries = (await pool.query("SELECT payload->'authority'->'commercial_valid_until' AS v FROM shared_jobs WHERE control_tenant_id=$1 AND payload->>'operation'='reconfigure'", [f.tenant])).rows
      expect(expiries.length).toBeGreaterThanOrEqual(2)
      for (const e of expiries) expect(e.v).toBeNull()
    })
  })

  describe('I7: the trial end never blocks sign-in', () => {
    it('the tenant status stays active through the lapse and the lock', async () => {
      const f = await endedTrial()
      const pushed: string[] = []
      await locked(f)
      await syncTenantStatus(pool, { runner: async i => { if (i.tenant_id === f.tenant) pushed.push(i.status) } })
      expect(pushed).not.toContain('suspended')
      expect(await row(f.subscription)).toMatchObject({ state: 'active', manual_suspension: false })
    })
  })

  describe('I3: a state where the paid applications are still writable is visible to the vendor', () => {
    it('a lock order that sits queued (the shared worker is down) is listed once it is overdue', async () => {
      const f = await endedTrial()
      await expireTrials(pool, { now, adapter, returnOrigin: origin, subscription_id: f.subscription })
      await processTrialLapses(pool, { now, adapter, subscription_id: f.subscription })
      const order = (await lapseOrders(f.subscription)).at(-1)
      await pool.query("UPDATE orders SET created_at=now() - interval '25 hours' WHERE id=$1", [order.id])
      await pool.query("UPDATE trial_lapses SET state='superseded' WHERE subscription_id<>$1", [f.subscription])
      const items = (await attention(pool, true)).items.filter(i => i.customer_id === f.customer)
      expect(items).toContainEqual(expect.objectContaining({ kind: 'stalled_activation' }))
    })
  })

  describe('I5: one failing subscription never stops another trial from lapsing or locking', () => {
    it('a poisoned snapshot fails alone in the expiry loop and in the lock loop', async () => {
      const broken = await endedTrial(), healthy = await endedTrial()
      await pool.query('ALTER TABLE subscription_revisions DISABLE TRIGGER USER')
      await pool.query("UPDATE subscription_revisions SET snapshot=jsonb_set(snapshot,'{entitlement,catalog_release_id}','\"not-a-uuid\"') WHERE id=(SELECT applied_revision_id FROM subscriptions WHERE id=$1)", [broken.subscription])
      await pool.query('ALTER TABLE subscription_revisions ENABLE TRIGGER USER')
      await expireTrials(pool, { now, adapter, returnOrigin: origin }).catch(() => undefined)
      expect(await lapseRow(healthy.subscription)).toMatchObject({ state: 'pending' })
      await processTrialLapses(pool, { now, adapter }).catch(() => undefined)
      expect(await lapseOrders(healthy.subscription)).toHaveLength(1)
      // The broken one is parked: leave it out of every later tick of the suite.
      await pool.query("UPDATE subscriptions SET trial_ends_at=now() + interval '400 days',revision=revision+1 WHERE id=$1 AND state='trialing'", [broken.subscription])
      await pool.query("UPDATE trial_lapses SET state='superseded' WHERE subscription_id=$1", [broken.subscription])
    })
  })

  describe('I6: what is quoted is what the renewal invoices', () => {
    it('a bought user: the quote\'s next renewal equals the renewal order', async () => {
      const f = await endedTrial({ requested_users: 4 })
      await locked(f)
      const quote = await quoteChange(f, { requested_users: 4 }, at(2))
      await payAndApply(f, await accept(f, quote))
      await pool.query("UPDATE subscriptions SET renewal_at='2026-11-01',revision=revision+1 WHERE id=$1", [f.subscription])
      const renewals = await generateRenewals(pool, { now, adapter, returnOrigin: origin, subscription_id: f.subscription })
      expect(renewals[0]!.due_now.minor).toBe(quote.next_renewal.minor)
    })
    it('kept branches: priced as the quote said once the customer buys one', async () => {
      const f = await endedTrial({}, plans.priced)
      for (const name of ['one', 'two', 'three']) await pool.query("INSERT INTO commercial_branches(id,subscription_id,tenant_id,name,kind,billing,state) VALUES($1,$2,$3,$4,'extra','paid','active')", [randomUUID(), f.subscription, f.tenant, name])
      await locked(f)
      vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(now)
      let quote
      try {
        quote = await createBranchQuote(pool, f.customer, JSON.stringify({ add: [{ name: 'fourth' }] }))
        const order = await accept(f, quote)
        await pool.query('UPDATE subscriptions SET applied_revision_id=target_revision_id,target_revision_id=NULL,revision=revision+1 WHERE id=$1', [f.subscription])
        await pool.query("UPDATE orders SET payment_state='paid',fulfillment_state='applied' WHERE id=$1", [order.id])
      } finally { vi.useRealTimers() }
      await pool.query("UPDATE subscriptions SET renewal_at='2026-11-01',revision=revision+1 WHERE id=$1", [f.subscription])
      const renewals = await generateRenewals(pool, { now, adapter, returnOrigin: origin, subscription_id: f.subscription })
      expect(renewals[0]!.due_now.minor).toBe(quote.next_renewal.minor)
    })
  })

  describe('I1 and I4: no reader prices the trial configuration after the trial end, and the free base is never dunned', () => {
    /** An unpaid renewal-kind invoice already overdue: the strongest input dunning can get. */
    async function overdueInvoice(f: F) {
      const orderId = randomUUID(), invoiceId = randomUUID()
      await pool.query(`INSERT INTO orders(id,customer_id,subscription_id,kind,quote_id,target_revision_id,expected_applied_revision_id,payment_state,fulfillment_state,idempotency_key,request_digest,due_now_minor,currency,exponent)
        VALUES($1,$2,$3,'renewal',$4,(SELECT applied_revision_id FROM subscriptions WHERE id=$3),NULL,'awaiting_payment','not_started',$5,'x',34500,'SAR',2)`, [orderId, f.customer, f.subscription, randomUUID(), `overdue-${orderId}`])
      await pool.query(`INSERT INTO invoices(id,customer_id,subscription_id,order_id,kind,currency,exponent,subtotal_minor,tax_minor,total_minor,period_start,period_end)
        VALUES($1,$2,$3,$4,'renewal','SAR',2,30000,4500,34500,'2026-10-01','2026-11-01')`, [invoiceId, f.customer, f.subscription, orderId])
    }
    for (const stage of ['window (lapsed, no lock order)', 'lock in flight', 'locked'] as const) {
      it(`${stage}: quotes price from the free base, branch changes follow the lock, renewal and dunning skip the trial price`, async () => {
        const f = await endedTrial()
        await expireTrials(pool, { now, adapter, returnOrigin: origin, subscription_id: f.subscription })
        if (stage !== 'window (lapsed, no lock order)') await processTrialLapses(pool, { now, adapter, subscription_id: f.subscription })
        if (stage === 'locked') { const order = (await lapseOrders(f.subscription)).at(-1); await applyOrder(f, order.id); await processTrialLapses(pool, { now, adapter, subscription_id: f.subscription }) }
        await freshUsage(f, at(0))
        // Reader 1: a quote for exactly the trial configuration is a purchase of every application, never a zero-due re-purchase.
        expect((await quoteChange(f, {}, now, [bundle.id])).due_now.minor).toBeGreaterThan(0)
        // Reader 2: a branch change waits for the lock while it is owed, and never carries the applications once it is applied.
        vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(now)
        try {
          if (stage === 'locked') expect((await createBranchQuote(pool, f.customer, JSON.stringify({ add: [{ name: 'x' }] }))).lines.filter(l => l.kind === 'bundle')).toEqual([])
          else await expect(createBranchQuote(pool, f.customer, JSON.stringify({ add: [{ name: 'x' }] }))).rejects.toMatchObject({ code: 'lock_pending' })
        } finally { vi.useRealTimers() }
        // Readers 3 and 4: renewal and dunning.
        await pool.query("UPDATE subscriptions SET renewal_at='2026-11-01',revision=revision+1 WHERE id=$1", [f.subscription])
        for (const order of await generateRenewals(pool, { now, adapter, returnOrigin: origin, subscription_id: f.subscription })) expect(order.due_now.minor).toBe(0)
        await overdueInvoice(f)
        expect(await applyDunning(pool, { now: new Date(now.getTime() + 60 * day) })).not.toContainEqual(expect.objectContaining({ subscription_id: f.subscription }))
        expect(await row(f.subscription)).toMatchObject({ state: 'active', manual_suspension: false })
        await pool.query("UPDATE subscriptions SET renewal_at='2099-01-01',revision=revision+1 WHERE id=$1", [f.subscription])
      })
    }
  })


  describe('F1: an order that applies after the end date but before the lapse runs (apply first, then expire)', () => {
    /** The trial end date has passed for the database clock too, which is what the receipt compares against. */
    const endNow = (f: F) => pool.query("UPDATE subscriptions SET trial_ends_at=now() - interval '1 hour',revision=revision+1 WHERE id=$1", [f.subscription])
    for (const paid of [false, true]) {
      it(`${paid ? 'a PAID' : 'a zero-due'} order applied first does not end the trial; the lapse then ${paid ? 'converts it' : 'locks the new revision'}`, async () => {
        const f = await endedTrial()
        const quote = await quoteChange(f, paid ? { requested_users: 4 } : {}, new Date(now.getTime() - 5 * day), [bundle.id])
        expect(quote.due_now.minor > 0).toBe(paid)
        const order = await accept(f, quote)
        if (paid) await pool.query("UPDATE orders SET payment_state='paid',fulfillment_state='queued' WHERE id=$1", [order.id])
        await pool.query("INSERT INTO commercial_outbox(id,kind,aggregate_id,dedupe_key,payload) VALUES($1,'fulfillment.enqueue',$2,$3,$4) ON CONFLICT DO NOTHING", [randomUUID(), order.id, order.target_revision_id, JSON.stringify({ order_id: order.id })])
        await endNow(f)
        await applyOrder(f, order.id)
        // The receipt only changes what is applied: the trial is ended by the lapse (or the conversion), never by the receipt.
        expect(await row(f.subscription)).toMatchObject({ state: 'trialing', applied_revision_id: order.target_revision_id })
        expect((await row(f.subscription)).trial_ends_at).not.toBeNull()
        const ended = await expireTrials(pool, { now, adapter, returnOrigin: origin, subscription_id: f.subscription })
        if (paid) {
          expect(await lapseRow(f.subscription)).toBeUndefined()
          expect(await row(f.subscription)).toMatchObject({ state: 'past_due' })
          expect(ended.orders).toHaveLength(1)
          expect(ended.orders[0]!.due_now.minor).toBeGreaterThan(19900)
        } else {
          expect(await lapseRow(f.subscription)).toMatchObject({ state: 'pending' })
          await processTrialLapses(pool, { now, adapter, subscription_id: f.subscription })
          const lock = (await lapseOrders(f.subscription)).at(-1)
          expect(lock.expected_applied_revision_id, 'the lock is built on the revision the zero-due order applied').toBe(order.target_revision_id)
          const job = await applyOrder(f, lock.id)
          for (const key of PAID_KEYS) expect(job.authority.entitlement.features[key], key).toBe(false)
          expect(await generateRenewals(pool, { now: at(1), adapter, returnOrigin: origin, subscription_id: f.subscription })).toEqual([])
        }
      })
    }
  })


  describe('F2: money paid is never invoiced again', () => {
    it('inside the window no order is accepted (lock_pending); after the lock the same upgrade is an ordinary paid change', async () => {
      const f = await endedTrial()
      await expireTrials(pool, { now, adapter, returnOrigin: origin, subscription_id: f.subscription })
      const quote = await quoteChange(f, { requested_users: 4 }, now, [bundle.id])
      expect(quote.due_now.minor).toBeGreaterThan(0)
      const sub = await getSubscription(pool, f.customer)
      await expect(acceptQuote(pool, { quote_id: quote.id, expected_subscription_revision: sub.revision, idempotency_key: randomUUID() }, vendor)).rejects.toMatchObject({ code: 'lock_pending', status: 409 })
      await processTrialLapses(pool, { now, adapter, subscription_id: f.subscription })
      await applyOrder(f, (await lapseOrders(f.subscription)).at(-1).id)
      await processTrialLapses(pool, { now, adapter, subscription_id: f.subscription })
      await freshUsage(f, now)
      const after = await quoteChange(f, { requested_users: 4 }, now, [bundle.id])
      await payAndApply(f, await accept(f, after))
      expect(await row(f.subscription)).toMatchObject({ state: 'active' })
      for (const key of PAID_KEYS) expect((await applied(f.subscription)).entitlement.features[key], key).toBe(true)
    })
    it('a paid order accepted before the end and applied after it: the first invoice is exactly the quoted renewal, dated from the trial end', async () => {
      const f = await endedTrial()
      const quote = await quoteChange(f, { requested_users: 4 }, new Date(now.getTime() - 5 * day), [bundle.id])
      const order = await accept(f, quote)
      await pool.query("UPDATE orders SET payment_state='paid',fulfillment_state='queued' WHERE id=$1", [order.id])
      await pool.query("INSERT INTO commercial_outbox(id,kind,aggregate_id,dedupe_key,payload) VALUES($1,'fulfillment.enqueue',$2,$3,$4) ON CONFLICT DO NOTHING", [randomUUID(), order.id, order.target_revision_id, JSON.stringify({ order_id: order.id })])
      await expireTrials(pool, { now, adapter, returnOrigin: origin, subscription_id: f.subscription })
      await applyOrder(f, order.id)
      await processTrialLapses(pool, { now: at(1), adapter, subscription_id: f.subscription })
      const invoices = (await pool.query("SELECT total_minor,period_start::text AS period_start FROM invoices WHERE subscription_id=$1 AND kind='renewal'", [f.subscription])).rows
      expect(invoices).toHaveLength(0)
      const generated = await generateRenewals(pool, { now: at(2), adapter, returnOrigin: origin, subscription_id: f.subscription })
      expect(generated).toHaveLength(1)
      expect(generated[0]!.due_now.minor).toBe(quote.next_renewal.minor)
      const invoice = (await pool.query("SELECT period_start::text AS period_start FROM invoices WHERE order_id=$1", [generated[0]!.id])).rows[0]
      expect(invoice.period_start).toBe('2026-11-19')
    })
  })


  describe('F3 and F7: what the customer names is bought, what they only echo is not', () => {
    it('the subscription read exposes purchased and held quantities apart', async () => {
      const f = await endedTrial({ requested_users: 10 })
      await locked(f)
      const view = (await getSubscription(pool, f.customer)).applied!
      expect(view.purchased_quantities).toEqual({ users: 3, storage_mb: 20480 })
      expect(view.held_quantities).toEqual({ users: 10 })
    })
    it('F3: buying an app from the holding state with the purchased values and the real branch count charges only the app', async () => {
      const f = await endedTrial({ requested_users: 10 }, plans.priced)
      for (const name of ['one', 'two', 'three']) await pool.query("INSERT INTO commercial_branches(id,subscription_id,tenant_id,name,kind,billing,state) VALUES($1,$2,$3,$4,'extra','paid','active')", [randomUUID(), f.subscription, f.tenant, name])
      await locked(f)
      await freshUsage(f, at(1))
      const quote = await quoteChange(f, { requested_extra_branches: 3, requested_users: 3, requested_storage_mb: 20480 }, at(1), [bundle.id])
      expect(quote.lines.filter(l => ['branch', 'users', 'storage'].includes(l.kind) && l.amount.minor > 0), 'only the application is charged').toEqual([])
      expect(quote.next_renewal.minor).toBeGreaterThan(0)
      await payAndApply(f, await accept(f, quote))
      const bought = await applied(f.subscription)
      expect(bought.pricing.paid_extra_branches).toBe(0)
      expect(bought.pricing.paid_users).toBe(0)
      expect(bought.entitlement.features['users.limit'], 'the held users are carried, not bought').toBe(10)
      expect(bought.held_ceilings['users.limit']).toMatchObject({ held: 10, target: 3 })
    })
    it('F7: naming a different quantity ends the hold: the new limit is what was requested, refused when usage exceeds it', async () => {
      const f = await endedTrial({ requested_users: 10 })
      await locked(f)
      await freshUsage(f, at(1), { 'users.limit': 7 })
      await expect(quoteChange(f, { requested_users: 5 }, at(1))).rejects.toMatchObject({ code: 'downgrade_below_usage' })
      await freshUsage(f, at(2), { 'users.limit': 4 })
      const quote = await quoteChange(f, { requested_users: 5 }, at(2))
      expect(new Set(quote.lines.filter(l => l.kind === 'users').map(l => l.quantity))).toEqual(new Set([2]))
      await payAndApply(f, await accept(f, quote))
      const after = await applied(f.subscription)
      expect(after.entitlement.features['users.limit']).toBe(5)
      expect(after.held_ceilings?.['users.limit']).toBeUndefined()
      expect(after.pricing.paid_users).toBe(2)
    })
  })

})
