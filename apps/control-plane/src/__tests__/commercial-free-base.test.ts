import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { Pool } from 'pg'
import type { Principal } from '@liwan/commercial-contracts'
import { client, money, monthly, setup, url } from './commercial-helpers.js'
import { convertTrial, endTrial, startTrial } from '../commercial/trial.js'
import { expireTrials } from '../commercial/trial-expiry.js'
import { processTrialLapses } from '../commercial/trial-lapse.js'
import { attention } from '../commercial/attention.js'
import { runSubscriptionReconfigure } from '../shared/subscription-reconfigure.js'
import { applyDunning, generateRenewals } from '../commercial/renewals.js'
import { applyReceipt, processFulfillmentOutbox } from '../commercial/fulfillment.js'
import { createQuoteForCustomer } from '../commercial/quotes.js'
import { acceptQuote } from '../commercial/orders.js'
import { recordUsage } from '../commercial/usage.js'
import { syncTenantStatus } from '../commercial/suspension.js'
import { enqueueOutbox } from '../commercial/outbox.js'
import { getSubscription } from '../commercial/subscriptions.js'
import { SimulatorAdapter } from '../commercial/payment-simulator.js'
import { sendTrialNotices } from '../commercial/trial-notices.js'
import { fixedReturnOrigin } from '../commercial/return-origin.js'

const POLICY = '6f1c3d8e-0000-4000-8000-000000000001'
const PAID_KEYS = ['pmo.enabled', 'pmo.change_control', 'pmo.baselines', 'pmo.evm']
const suite = url ? describe : describe.skip
suite('trial end keeps the company on the free base (issue 491)', () => {
  const pool = new Pool({ connectionString: url, max: 6 })
  const api = client(pool)
  const reason = 'Free base acceptance'
  const now = new Date('2026-11-20T09:00:00Z')
  const origin = fixedReturnOrigin('https://liwan.test')
  const adapter = new SimulatorAdapter()
  let plan: any, bundle: any, vendor: Principal

  beforeAll(async () => {
    const { version } = await setup(pool)
    const release = (await api('POST', '/catalog/releases', { catalog_version: version, reason })).body
    const app = release.applications.find((a: any) => a.features.some((f: any) => f.key === 'projects.max_projects'))
    const b = await api('POST', '/bundles', { name: `Projects ${randomUUID()}`, description: 'Projects', audience: { kind: 'public' }, catalog_release_id: release.id,
      selections: [{ app_id: app.id, feature_keys: ['pmo.enabled'] }], domain_limits: { 'projects.max_projects': 10 }, prices: [{ cadence: monthly, amount: money(19900) }] })
    const bv = await api('POST', `/bundles/${b.body.id}/validate`, { edit_revision: 1, reason })
    bundle = (await api('POST', `/bundles/${b.body.id}/publish`, { edit_revision: bv.body.edit_revision, reason })).body
    const p = await api('POST', '/plans', { name: `Free base ${randomUUID()}`, audience: { kind: 'public' }, term_months: 12, currency: 'SAR',
      prices: [{ cadence: monthly, amount: money(0) }], platform_limits: {}, included_bundle_revision_ids: [], optional_bundle_revision_ids: [bundle.id],
      included_extra_branches: 1, extra_branch_prices: [{ cadence: monthly, amount: money(0) }], extra_branches_limit: null,
      included_users: 3, included_storage_mb: 20480, storage_step_mb: 10240, storage_step_threshold_mb: 102400, storage_large_step_mb: 102400,
      user_prices: [{ cadence: monthly, amount: money(2900) }], storage_prices: [{ cadence: monthly, amount: money(100) }],
      policy_revision_id: POLICY, trial_days: 14, grace_days: 7, auto_suspend: true, auto_renew_allowed: true })
    expect(p.status, JSON.stringify(p.body)).toBe(201)
    const pv = await api('POST', `/plans/${p.body.id}/validate`, { edit_revision: 1, reason })
    expect(pv.status, JSON.stringify(pv.body)).toBe(200)
    plan = (await api('POST', `/plans/${p.body.id}/publish`, { edit_revision: pv.body.edit_revision, reason })).body
    vendor = { actor_id: '7', kind: 'vendor', customer_id: null, tenant_id: null, capabilities: ['vendor.subscriptions.manage', 'vendor.pricing.manage'] } as unknown as Principal
  })
  afterAll(async () => { await pool.end() })

  const request = () => ({ kind: 'new' as const, plan_revision_id: plan.id, bundle_revision_ids: [bundle.id], cadence: monthly,
    requested_extra_branches: 0, requested_users: 3, requested_storage_mb: 20480 })

  /** A customer whose trial of the paid application ended a day before `now`, with the trial order applied. */
  async function endedTrial(over: Record<string, unknown> = {}) {
    const customer = randomUUID(), tenant = randomUUID()
    const slug = `t${tenant.replaceAll('-', '')}`
    await pool.query("INSERT INTO tenants(id,name,commercial_mode,hosting_model,inventory_target,operations_enabled) VALUES($1,'Free base','saas','shared_managed',$2,true)", [tenant, slug])
    await pool.query('INSERT INTO customers(id,name,tenant_id,admin_name,admin_login) VALUES($1,$2,$3,$4,$5)', [customer, 'Free base', tenant, 'Manager', `${customer}@example.test`])
    await pool.query('INSERT INTO shared_registry_bindings(control_tenant_id,tenant_id,host,database_name,filestore,enabled,registry_revision) VALUES($1,$2,$3,$4,$4,true,1)', [tenant, slug, `${slug}.test`, `liwan_scratch_${slug.slice(1)}`])
    const principal = { actor_id: '7', kind: 'customer', customer_id: customer, tenant_id: tenant, capabilities: ['subscription.manage'] } as unknown as Principal
    await startTrial(pool, { customer_id: customer, request: { ...request(), ...over }, principal, now: new Date(now.getTime() - 15 * 86_400_000) })
    await pool.query('UPDATE subscriptions SET applied_revision_id=target_revision_id,target_revision_id=NULL,revision=revision+1 WHERE customer_id=$1', [customer])
    await pool.query("UPDATE orders SET fulfillment_state='applied' WHERE customer_id=$1", [customer])
    await pool.query("UPDATE commercial_outbox SET status='done' WHERE kind='fulfillment.enqueue' AND aggregate_id IN (SELECT id::text FROM orders WHERE customer_id=$1)", [customer])
    const sub = await getSubscription(pool, customer)
    return { customer, tenant, subscription: sub.id }
  }
  const row = async (id: string) => (await pool.query('SELECT * FROM subscriptions WHERE id=$1', [id])).rows[0]
  /** What the shared worker would push to Odoo for the order, and the receipt it would return. */
  async function pushed(tenant: string, orderId: string) {
    await processFulfillmentOutbox(pool, { limit: 100 })
    const job = (await pool.query("SELECT payload FROM shared_jobs WHERE control_tenant_id=$1 AND payload->'authority'->>'order_id'=$2", [tenant, orderId])).rows[0].payload
    const receipt = { order_id: orderId, tenant_id: job.binding.database, database: job.binding.database, target_revision_id: job.authority.target_revision_id,
      observed_entitlement_digest: job.authority.entitlement.digest, observed_at: new Date().toISOString(), branch_bindings: [], modules_installed: [] }
    return { job, receipt }
  }
  const lapseOrder = async (subscription: string) => (await pool.query("SELECT * FROM orders WHERE subscription_id=$1 AND idempotency_key LIKE $2 ORDER BY created_at DESC,id LIMIT 1", [subscription, `trial-lapse:${subscription}:%`])).rows[0]
  const lapseRow = async (subscription: string) => (await pool.query('SELECT * FROM trial_lapses WHERE subscription_id=$1', [subscription])).rows[0]
  /** A fresh usage sample for every numeric key of what the subscription holds now, the way the usage collector provides it. */
  async function freshUsage(f: { tenant: string; subscription: string }, at: Date, over: Record<string, number> = {}) {
    const numeric = Object.entries((await pool.query('SELECT snapshot FROM subscription_revisions WHERE id=(SELECT applied_revision_id FROM subscriptions WHERE id=$1)', [f.subscription])).rows[0].snapshot.entitlement.features)
      .filter(([, value]) => typeof value === 'number').map(([key]) => key)
    await recordUsage(pool, { tenant_id: f.tenant, observed_at: at, source: 'free-base',
      metrics: { ...Object.fromEntries(numeric.map(key => [key, 0])), ...over },
      limit_gates: Object.fromEntries(numeric.map(key => [key, key === 'projects.max_projects' ? ['pmo.enabled'] : []])) })
  }
  /** The second step of the lapse: lower the entitlement to the base, as the scheduler does after the lapse. */
  async function lower(f: { tenant: string; subscription: string }, at = now, over: Record<string, number> = {}) {
    await freshUsage(f, at, over)
    await processTrialLapses(pool, { now: at, adapter, subscription_id: f.subscription })
  }
  const failingRunner = (code: string) => async () => { throw new Error(code) }
  const okRunner = async ({ job }: { job: any }) => ({ order_id: job.authority.order_id, tenant_id: job.binding.database, database: job.binding.database,
    target_revision_id: job.authority.target_revision_id, observed_entitlement_digest: job.authority.entitlement.digest, observed_at: new Date().toISOString(), branch_bindings: [], modules_installed: [] })
  /** Enqueues the order's job and runs it with `runner`, as the shared worker would. */
  async function runJob(orderId: string, runner: any) {
    await processFulfillmentOutbox(pool, { limit: 100 })
    const jobId = (await pool.query('SELECT job_id FROM fulfillment_effects WHERE order_id=$1', [orderId])).rows[0].job_id
    return runSubscriptionReconfigure(pool, jobId, runner).catch(e => e)
  }

  it('keeps the subscription active, invoices nothing and queues the base as a zero-due change', async () => {
    const f = await endedTrial()
    const result = await expireTrials(pool, { now, adapter, returnOrigin: origin, subscription_id: f.subscription })
    expect(result).toMatchObject({ expired: [], lapsed: [f.subscription], orders: [] })
    const sub = await row(f.subscription)
    expect(sub).toMatchObject({ state: 'active', trial_ends_at: null, grace_ends_at: null, billing_blocked_at: null })
    // The lapse is complete at once: the trial's hard expiry is already on its way out of Odoo.
    expect(sub.target_revision_id).toBeNull()
    expect(await lapseRow(f.subscription)).toMatchObject({ state: 'pending', reason: null })
    const expiry = (await pool.query("SELECT payload FROM shared_jobs WHERE control_tenant_id=$1", [f.tenant])).rows
    expect(expiry).toHaveLength(1)
    expect(expiry[0].payload.authority.commercial_valid_until).toBeNull()
    expect((await pool.query('SELECT count(*)::int AS n FROM invoices WHERE customer_id=$1', [f.customer])).rows[0].n).toBe(0)
    await lower(f)
    expect((await row(f.subscription)).target_revision_id).toBeTruthy()
    expect(await lapseOrder(f.subscription)).toMatchObject({ kind: 'change', payment_state: 'not_required', fulfillment_state: 'queued', due_now_minor: '0' })
  })

  it('pushes base keys open, paid keys closed, free limits, no expiry and no suspension, then applies the receipt', async () => {
    const f = await endedTrial()
    await expireTrials(pool, { now, adapter, returnOrigin: origin, subscription_id: f.subscription })
    await lower(f)
    const order = await lapseOrder(f.subscription)
    const { job, receipt } = await pushed(f.tenant, order.id)
    const features = job.authority.entitlement.features
    for (const key of PAID_KEYS) expect(features[key], key).toBe(false)
    for (const key of ['tasks.enabled', 'chat.enabled', 'meetings.enabled', 'documents.enabled', 'operations.enabled', 'ai.enabled']) expect(features[key], key).toBe(true)
    expect(features['users.limit']).toBe(3)
    expect(features['storage.limit_mb']).toBe(20480)
    expect(features['projects.max_projects']).toBe(0)
    expect(job.authority.commercial_valid_until).toBeNull()
    const wire = JSON.stringify(job)
    expect(wire).not.toContain('retained_read_features')
    expect(wire).not.toContain('suspended')
    await applyReceipt(pool, { order_id: order.id, receipt })
    const sub = await row(f.subscription)
    expect(sub).toMatchObject({ state: 'active', target_revision_id: null, trial_ends_at: null })
    expect(sub.applied_revision_id).toBe(order.target_revision_id)
    // Odoo is never told to suspend the tenant: suspension stays a manual vendor action.
    const statuses: string[] = []
    await syncTenantStatus(pool, { runner: async i => { if (i.tenant_id === f.tenant) statuses.push(i.status) } })
    expect(statuses).not.toContain('suspended')
    expect((await row(f.subscription)).tenant_status_pushed ?? 'active').toBe('active')
  })

  it('is replay safe and concurrency safe: a repeated or simultaneous run creates one order', async () => {
    const f = await endedTrial()
    const run = () => expireTrials(pool, { now, adapter, returnOrigin: origin, subscription_id: f.subscription })
    await Promise.all([run(), run(), run()])
    await run()
    await freshUsage(f, now)
    const lowerOnce = () => processTrialLapses(pool, { now, adapter, subscription_id: f.subscription })
    await Promise.all([lowerOnce(), lowerOnce(), lowerOnce()])
    await lowerOnce()
    expect((await pool.query("SELECT count(*)::int AS n FROM orders WHERE subscription_id=$1 AND kind='change'", [f.subscription])).rows[0].n).toBe(1)
    expect((await pool.query('SELECT count(*)::int AS n FROM subscription_revisions WHERE subscription_id=$1', [f.subscription])).rows[0].n).toBe(2)
    expect((await pool.query("SELECT count(*)::int AS n FROM trial_lapses WHERE subscription_id=$1", [f.subscription])).rows[0].n).toBe(1)
    expect((await pool.query("SELECT count(*)::int AS n FROM shared_jobs WHERE control_tenant_id=$1", [f.tenant])).rows[0].n).toBe(1)
    expect(await lapseRow(f.subscription)).toMatchObject({ state: 'ordered', reason: null, attempts: 0 })
  })

  describe('an order that is not the free base when the trial ends', () => {
    /** The customer accepted a paid change during the trial and has not paid. */
    async function unpaidChange(f: { customer: string; tenant: string; subscription: string }) {
      await freshUsage(f, new Date(now.getTime() - 86_400_000))
      const sub = await getSubscription(pool, f.customer)
      const quote = await createQuoteForCustomer(pool, { customer_id: f.customer, request: { ...request(), kind: 'change', requested_users: 4, subscription_id: sub.id, expected_subscription_revision: sub.revision, effective_date: '2026-11-18' } }, new Date(now.getTime() - 86_400_000))
      return (await acceptQuote(pool, { quote_id: quote.id, expected_subscription_revision: sub.revision, idempotency_key: randomUUID() }, vendor)).order
    }
    it('cancels an unpaid, not-started order and moves to the base; the customer can accept a new quote', async () => {
      const f = await endedTrial()
      const unpaid = await unpaidChange(f)
      expect(unpaid.payment_state).toBe('awaiting_payment')
      await expireTrials(pool, { now, adapter, returnOrigin: origin, subscription_id: f.subscription })
      expect(await row(f.subscription)).toMatchObject({ state: 'active', trial_ends_at: null })
      await lower(f)
      expect((await pool.query('SELECT cancelled FROM orders WHERE id=$1', [unpaid.id])).rows[0].cancelled).toBe(true)
      expect((await pool.query("SELECT status FROM invoices WHERE order_id=$1", [unpaid.id])).rows[0].status).toBe('void')
      expect(await lapseRow(f.subscription)).toMatchObject({ state: 'ordered', reason: null })
      expect(await lapseOrder(f.subscription)).toMatchObject({ fulfillment_state: 'queued' })
    })
    it('waits for a paid order in fulfillment, then tells the vendor once the wait is over', async () => {
      const f = await endedTrial()
      const paid = await unpaidChange(f)
      await pool.query("UPDATE orders SET payment_state='paid',fulfillment_state='queued' WHERE id=$1", [paid.id])
      await expireTrials(pool, { now, adapter, returnOrigin: origin, subscription_id: f.subscription })
      await lower(f)
      expect(await lapseOrder(f.subscription)).toBeUndefined()
      expect(await lapseRow(f.subscription)).toMatchObject({ state: 'pending', reason: null })
      const later = new Date(now.getTime() + 4 * 86_400_000)
      await lower(f, later)
      expect(await lapseRow(f.subscription)).toMatchObject({ state: 'pending', reason: 'order_in_flight' })
      const items = (await attention(pool, true)).items.filter(i => i.customer_id === f.customer)
      expect(items).toContainEqual(expect.objectContaining({ kind: 'free_base_blocked', detail: 'order_in_flight' }))
      // Once that order is applied the customer is on what they paid for: there is nothing left to lower.
      await pool.query("UPDATE subscriptions SET applied_revision_id=target_revision_id,target_revision_id=NULL,revision=revision+1 WHERE id=$1", [f.subscription])
      await pool.query("UPDATE trial_lapses SET next_attempt_at=now() WHERE subscription_id=$1", [f.subscription])
      await processTrialLapses(pool, { now: new Date(later.getTime() + 60 * 86_400_000), adapter, subscription_id: f.subscription })
      expect(await lapseRow(f.subscription)).toMatchObject({ state: 'superseded', reason: null })
    })
  })

  describe('lowering that does not go through (issue 491, A1)', () => {
    it('push fails once, is superseded without blocking the customer, and succeeds on the retry after backoff', async () => {
      const f = await endedTrial()
      await expireTrials(pool, { now, adapter, returnOrigin: origin, subscription_id: f.subscription })
      await lower(f)
      const first = await lapseOrder(f.subscription)
      await runJob(first.id, failingRunner('downgrade_below_usage'))
      expect((await pool.query('SELECT fulfillment_state FROM orders WHERE id=$1', [first.id])).rows[0].fulfillment_state).toBe('failed')
      expect((await row(f.subscription)).target_revision_id).toBe(first.target_revision_id)
      // The next pass closes the refused job, cancels the failed order and releases the subscription.
      await processTrialLapses(pool, { now, adapter, subscription_id: f.subscription })
      expect(await lapseRow(f.subscription)).toMatchObject({ state: 'pending', order_id: null, reason: 'downgrade_below_usage', attempts: 1 })
      expect(await row(f.subscription)).toMatchObject({ target_revision_id: null, state: 'active' })
      expect((await pool.query('SELECT cancelled FROM orders WHERE id=$1', [first.id])).rows[0].cancelled).toBe(true)
      expect((await pool.query("SELECT state FROM shared_jobs WHERE payload->'authority'->>'order_id'=$1", [first.id])).rows[0].state).toBe('failed')
      // Backoff: nothing happens before it is over, then a new order (a new attempt key) goes through.
      await lower(f, new Date(now.getTime() + 3_600_000))
      expect(await lapseRow(f.subscription)).toMatchObject({ state: 'pending', attempts: 1 })
      await lower(f, new Date(now.getTime() + 3 * 3_600_000))
      const second = await lapseOrder(f.subscription)
      expect(second.id).not.toBe(first.id)
      expect(second.idempotency_key).toBe(`trial-lapse:${f.subscription}:2`)
      expect((await runJob(second.id, okRunner)).state).toBe('verified')
      await processTrialLapses(pool, { now: new Date(now.getTime() + 4 * 3_600_000), adapter, subscription_id: f.subscription })
      expect(await lapseRow(f.subscription)).toMatchObject({ state: 'done', reason: null })
      expect((await row(f.subscription)).applied_revision_id).toBe(second.target_revision_id)
    })
    it('keeps failing: the tenant stays usable, the vendor sees why, and the customer can still upgrade', async () => {
      const f = await endedTrial({ requested_users: 10 })
      await expireTrials(pool, { now, adapter, returnOrigin: origin, subscription_id: f.subscription })
      // The company uses more than the free base allows: refused up front, before any order or push.
      await lower(f, now, { 'users.limit': 9 })
      expect(await lapseRow(f.subscription)).toMatchObject({ state: 'pending', reason: 'downgrade_below_usage:users.limit', attempts: 1 })
      expect(await lapseOrder(f.subscription)).toBeUndefined()
      expect(await row(f.subscription)).toMatchObject({ state: 'active', trial_ends_at: null, target_revision_id: null, manual_suspension: false })
      // Whatever Odoo holds now cannot lock it: the expiry was cleared by the lapse itself.
      const jobs = (await pool.query("SELECT payload FROM shared_jobs WHERE control_tenant_id=$1", [f.tenant])).rows
      expect(jobs.map(j => j.payload.authority.commercial_valid_until)).toEqual([null])
      const items = (await attention(pool, true)).items.filter(i => i.customer_id === f.customer)
      expect(items).toContainEqual(expect.objectContaining({ kind: 'free_base_blocked', detail: 'downgrade_below_usage:users.limit' }))
      // The customer is not held: an upgrade quote is accepted.
      await freshUsage(f, now, { 'users.limit': 9 })
      const sub = await getSubscription(pool, f.customer)
      const quote = await createQuoteForCustomer(pool, { customer_id: f.customer, request: { ...request(), kind: 'change', requested_users: 10, subscription_id: sub.id, expected_subscription_revision: sub.revision } }, now)
      const accepted = await acceptQuote(pool, { quote_id: quote.id, expected_subscription_revision: sub.revision, idempotency_key: randomUUID() }, vendor)
      expect(accepted.order.kind).toBe('change')
    })
    it('a failure that may have written to Odoo keeps its job for an operator, but still releases the customer', async () => {
      const f = await endedTrial()
      await expireTrials(pool, { now, adapter, returnOrigin: origin, subscription_id: f.subscription })
      await lower(f)
      const order = await lapseOrder(f.subscription)
      await runJob(order.id, failingRunner('observed_mismatch'))
      await processTrialLapses(pool, { now, adapter, subscription_id: f.subscription })
      expect(await lapseRow(f.subscription)).toMatchObject({ state: 'pending', reason: 'observed_mismatch' })
      expect((await row(f.subscription)).target_revision_id).toBeNull()
      expect((await pool.query("SELECT state FROM shared_jobs WHERE payload->'authority'->>'order_id'=$1", [order.id])).rows[0].state).toBe('needs_intervention')
    })
  })

  it('a vendor ending the trial lands on the same base; the lapse clears the expiry once and the base order carries no second one', async () => {
    const f = await endedTrial()
    await pool.query("UPDATE subscriptions SET trial_ends_at=$2,revision=revision+1 WHERE id=$1", [f.subscription, new Date(now.getTime() + 5 * 86_400_000)])
    await endTrial(pool, { subscription_id: f.subscription, reason: 'End now', actor: 'vendor', now, adapter, returnOrigin: origin })
    expect(await row(f.subscription)).toMatchObject({ state: 'active', trial_ends_at: null })
    expect((await pool.query("SELECT count(*)::int AS n FROM shared_jobs WHERE control_tenant_id=$1", [f.tenant])).rows[0].n).toBe(1)
    await lower(f)
    const { job } = await pushed(f.tenant, (await lapseOrder(f.subscription)).id)
    expect(job.authority.commercial_valid_until).toBeNull()
    expect((await pool.query("SELECT count(*)::int AS n FROM shared_jobs WHERE control_tenant_id=$1", [f.tenant])).rows[0].n).toBe(2)
  })

  it('tells the customer what locks instead of quoting an invoice that will not come', async () => {
    const f = await endedTrial()
    await pool.query('UPDATE subscriptions SET trial_ends_at=$2,revision=revision+1 WHERE id=$1', [f.subscription, new Date(now.getTime() + 86_400_000)])
    const sent: string[] = []
    await sendTrialNotices(pool, { now, mail: { send: async (m: { text: string }) => { sent.push(m.text) } } as any })
    expect(sent.some(text => text.includes('القاعدة المجانية') && !text.includes('أول فاتورة'))).toBe(true)
  })

  it('sends a trial notice once even when two workers run at the same time, and a failing send does not stop the others', async () => {
    const a = await endedTrial(), b = await endedTrial()
    for (const f of [a, b]) await pool.query('UPDATE subscriptions SET trial_ends_at=$2,revision=revision+1 WHERE id=$1', [f.subscription, new Date(now.getTime() + 86_400_000)])
    const sent: string[] = []
    const mail = { send: async (m: { to: string }) => { if (m.to === `${a.customer}@example.test`) throw new Error('smtp down'); sent.push(m.to) } } as any
    await Promise.all([sendTrialNotices(pool, { now, mail }), sendTrialNotices(pool, { now, mail })])
    // One day left catches up both thresholds (3 and 1): one mail each, never one per worker.
    expect(sent.filter(to => to === `${b.customer}@example.test`)).toHaveLength(2)
    expect((await pool.query("SELECT status FROM commercial_outbox WHERE kind='trial.notice' AND aggregate_id=$1", [a.subscription])).rows.map(r => r.status)).toContain('failed')
  })

  it('a customer who converts still gets the first invoice for what they chose', async () => {
    const f = await endedTrial()
    await pool.query("UPDATE subscriptions SET trial_ends_at=$2,revision=revision+1 WHERE id=$1", [f.subscription, new Date(now.getTime() + 5 * 86_400_000)])
    const converted = await convertTrial(pool, { customer_id: f.customer, now, adapter, returnOrigin: origin })
    expect(converted.order).toBeTruthy()
    expect((await row(f.subscription)).state).toBe('past_due')
    expect((await pool.query('SELECT count(*)::int AS n FROM invoices WHERE customer_id=$1', [f.customer])).rows[0].n).toBe(1)
  })

  it('renews the free base without a return origin and never flags it billing-blocked', async () => {
    const f = await endedTrial()
    await expireTrials(pool, { now, adapter, returnOrigin: origin, subscription_id: f.subscription })
    await lower(f)
    const order = await lapseOrder(f.subscription)
    await applyReceipt(pool, { order_id: order.id, receipt: (await pushed(f.tenant, order.id)).receipt })
    await pool.query("UPDATE subscriptions SET renewal_at='2026-11-01',revision=revision+1 WHERE id=$1", [f.subscription])
    const generated = await generateRenewals(pool, { now, adapter, returnOrigin: fixedReturnOrigin('http://billing.example.com'), subscription_id: f.subscription })
    expect(generated).toHaveLength(1)
    expect(generated[0]).toMatchObject({ payment_state: 'not_required' })
    expect(await row(f.subscription)).toMatchObject({ state: 'active', billing_blocked_at: null })
  })

  it('full cycle: trial, free base, unpaid upgrade never suspends, paid upgrade opens the application again', async () => {
    const f = await endedTrial()
    await expireTrials(pool, { now, adapter, returnOrigin: origin, subscription_id: f.subscription })
    await lower(f)
    const lapse = await lapseOrder(f.subscription)
    await applyReceipt(pool, { order_id: lapse.id, receipt: (await pushed(f.tenant, lapse.id)).receipt })
    // The customer asks for the paid application again; the invoice stays unpaid long past its due date.
    const numeric = Object.entries((await pool.query('SELECT snapshot FROM subscription_revisions WHERE id=(SELECT applied_revision_id FROM subscriptions WHERE id=$1)', [f.subscription])).rows[0].snapshot.entitlement.features)
      .filter(([, value]) => typeof value === 'number').map(([key]) => key)
    await recordUsage(pool, { tenant_id: f.tenant, observed_at: now, source: 'free-base',
      metrics: Object.fromEntries(numeric.map(key => [key, 0])),
      limit_gates: Object.fromEntries(numeric.map(key => [key, key === 'projects.max_projects' ? ['pmo.enabled'] : []])) })
    const sub = await getSubscription(pool, f.customer)
    const quote = await createQuoteForCustomer(pool, { customer_id: f.customer, request: { ...request(), kind: 'change', subscription_id: sub.id, expected_subscription_revision: sub.revision } }, now)
    expect(quote.due_now.minor).toBeGreaterThan(0)
    const { order } = await acceptQuote(pool, { quote_id: quote.id, expected_subscription_revision: sub.revision, idempotency_key: randomUUID() }, vendor)
    expect(order.payment_state).toBe('awaiting_payment')
    const late = new Date(now.getTime() + 90 * 86_400_000)
    expect((await pool.query('SELECT count(*)::int AS n FROM invoices WHERE order_id=$1 AND status=\'issued\' AND due_at < $2', [order.id, late])).rows[0].n).toBe(1)
    expect(await applyDunning(pool, { now: late })).not.toContainEqual(expect.objectContaining({ subscription_id: f.subscription }))
    expect(await row(f.subscription)).toMatchObject({ state: 'active', manual_suspension: false })
    // Payment arrives: the upgrade opens the application.
    await pool.query("UPDATE orders SET payment_state='paid' WHERE id=$1", [order.id])
    await enqueueOutbox(pool, { kind: 'fulfillment.enqueue', aggregate_id: order.id, dedupe_key: order.target_revision_id, payload: { order_id: order.id } })
    const paid = await pushed(f.tenant, order.id)
    for (const key of PAID_KEYS) expect(paid.job.authority.entitlement.features[key], key).toBe(true)
    await applyReceipt(pool, { order_id: order.id, receipt: paid.receipt })
    expect((await row(f.subscription)).applied_revision_id).toBe(order.target_revision_id)
  })
})
