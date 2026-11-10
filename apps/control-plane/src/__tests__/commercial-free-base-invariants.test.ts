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
})
