import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { Pool } from 'pg'
import { riyadhDate, type Principal } from '@liwan/commercial-contracts'
import { client, money, monthly, setup, url } from './commercial-helpers.js'
import { activateSignupTrial } from '../commercial/trial-first-login.js'
import { convertTrial, extendTrial, startTrial } from '../commercial/trial.js'
import { endTrialOn, expireTrials } from '../commercial/trial-expiry.js'
import { LOCK_RETRY_MS, processFreeBaseLocks } from '../commercial/free-base-lock.js'
import { attention } from '../commercial/attention.js'
import { assertReconfigureAuthority, runSubscriptionReconfigure, type SubscriptionRunner } from '../shared/subscription-reconfigure.js'
import { applyDunning, generateRenewals } from '../commercial/renewals.js'
import { processFulfillmentOutbox } from '../commercial/fulfillment.js'
import { createQuoteForCustomer } from '../commercial/quotes.js'
import { acceptQuoteOn, cancelOrder } from '../commercial/orders.js'
import { collectUsage } from '../commercial/usage-collector.js'
import { recordUsage } from '../commercial/usage.js'
import { resumeSubscription, suspendSubscription, syncTenantStatus } from '../commercial/suspension.js'
import { getSubscription } from '../commercial/subscriptions.js'
import { SimulatorAdapter } from '../commercial/payment-simulator.js'
import { fixedReturnOrigin } from '../commercial/return-origin.js'
import { pushCommercialExpiry } from '../commercial/expiry-push.js'
import { transaction } from '../db.js'
import { digestOf } from '../commercial/lifecycle.js'
import { createPaymentAttempt, handleProviderEvent } from '../commercial/payments.js'
import { recoverPaidFulfillment } from '../commercial/paid-fulfillment-recovery.js'
import { processRefundOutbox, refundCreditNote } from '../commercial/settlements.js'
import { recoverCommercialSystemJobs } from '../shared/commercial-recovery.js'
import { trialEndPreview } from '../commercial/trial-preview.js'
import { getAnalytics } from '../commercial/analytics.js'
import { sendTrialNotices } from '../commercial/trial-notices.js'
import { sendBillingNotices } from '../commercial/billing-notices.js'
import { sendOverLimitNotices } from '../commercial/over-limit-notices.js'

// The deadline push stays real; a test can make one call fail.
vi.mock('../commercial/expiry-push.js', async original => {
  const real = await original<typeof import('../commercial/expiry-push.js')>()
  return { ...real, pushCommercialExpiry: vi.fn(real.pushCommercialExpiry) }
})

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
  let plan: any, bundle: any, secondBundle: any, vendor: Principal

  beforeAll(async () => {
    const { version } = await setup(pool)
    const release = (await api('POST', '/catalog/releases', { catalog_version: version, reason })).body
    const app = release.applications.find((a: any) => a.features.some((f: any) => f.key === 'projects.max_projects'))
    const sell = async (app: any, key: string, domain_limits: Record<string, number>) => {
      const b = await api('POST', '/bundles', { name: `Test bundle ${randomUUID()}`, description: 'Test', audience: { kind: 'public' },
        catalog_release_id: release.id, selections: [{ app_id: app.id, feature_keys: [key] }], domain_limits, prices: [{ cadence: monthly, amount: money(19900) }] })
      const bv = await api('POST', `/bundles/${b.body.id}/validate`, { edit_revision: 1, reason })
      return (await api('POST', `/bundles/${b.body.id}/publish`, { edit_revision: bv.body.edit_revision, reason })).body
    }
    bundle = await sell(app, 'pmo.enabled', { 'projects.max_projects': 10 })
    secondBundle = await sell(release.applications.find((a: any) => a.features.some((f: any) => f.key === 'finance.enabled')), 'finance.enabled', {})
    const p = await api('POST', '/plans', { name: `Free base ${randomUUID()}`, audience: { kind: 'public' }, term_months: 12, currency: 'SAR',
      prices: [{ cadence: monthly, amount: money(0) }], platform_limits: {}, included_bundle_revision_ids: [], optional_bundle_revision_ids: [bundle.id, secondBundle.id],
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
  async function endedTrial(over: Record<string, unknown> = {}, bound = true, start = new Date(now.getTime() - 15 * 86_400_000), waitForFirstLogin = false) {
    const customer = randomUUID(), tenant = randomUUID()
    const slug = `t${tenant.replaceAll('-', '')}`
    await pool.query("INSERT INTO tenants(id,name,commercial_mode,hosting_model,inventory_target,operations_enabled,post_trial_supported,excess_supported) VALUES($1,'Free base','saas','shared_managed',$2,true,true,true)", [tenant, slug])
    await pool.query('INSERT INTO customers(id,name,tenant_id,admin_name,admin_login) VALUES($1,$2,$3,$4,$5)', [customer, 'Free base', tenant, 'Manager', `${customer}@example.test`])
    const bind = () => pool.query('INSERT INTO shared_registry_bindings(control_tenant_id,tenant_id,host,database_name,filestore,enabled,registry_revision) VALUES($1,$2,$3,$4,$4,true,1)', [tenant, slug, `${slug}.test`, `liwan_scratch_${slug.slice(1)}`])
    if (bound) await bind()
    const principal = { actor_id: '7', kind: 'customer', customer_id: customer, tenant_id: tenant, capabilities: ['subscription.manage'] } as unknown as Principal
    await startTrial(pool, { customer_id: customer, request: { ...request(), ...over }, principal, now: start, waitForFirstLogin })
    if (waitForFirstLogin) return { customer, tenant, subscription: (await getSubscription(pool, customer)).id, bind, principal }
    await pool.query('UPDATE subscriptions SET applied_revision_id=target_revision_id,target_revision_id=NULL,revision=revision+1 WHERE customer_id=$1', [customer])
    await pool.query("UPDATE orders SET fulfillment_state='applied' WHERE customer_id=$1", [customer])
    await pool.query("UPDATE commercial_outbox SET status='done' WHERE kind='fulfillment.enqueue' AND aggregate_id IN (SELECT id::text FROM orders WHERE customer_id=$1)", [customer])
    const sub = await getSubscription(pool, customer)
    return { customer, tenant, subscription: sub.id, bind, principal }
  }
  const row = async (id: string) => (await pool.query('SELECT * FROM subscriptions WHERE id=$1', [id])).rows[0]
  /** What the shared worker would push to Odoo for the order, and the receipt it would return. */
  /** Runs the fulfillment outbox until this order's job exists (other suites leave pending rows ahead of it). */
  async function enqueued(orderId: string) {
    for (let pass = 0; pass < 20; pass++) {
      await processFulfillmentOutbox(pool, { limit: 100 })
      if ((await pool.query('SELECT 1 FROM fulfillment_effects WHERE order_id=$1 AND job_id IS NOT NULL', [orderId])).rowCount) return
    }
    throw new Error('order job was never enqueued')
  }
  async function pushed(tenant: string, orderId: string) {
    await enqueued(orderId)
    const job = (await pool.query("SELECT payload FROM shared_jobs WHERE control_tenant_id=$1 AND payload->'authority'->>'order_id'=$2", [tenant, orderId])).rows[0].payload
    const receipt = { order_id: orderId, tenant_id: job.binding.database, database: job.binding.database, target_revision_id: job.authority.target_revision_id,
      observed_entitlement_digest: job.authority.entitlement.digest, observed_at: beforeEnd.toISOString(), branch_bindings: [], modules_installed: [] }
    return { job, receipt }
  }
  const lapseOrder = async (subscription: string) => (await pool.query("SELECT * FROM orders WHERE subscription_id=$1 AND idempotency_key LIKE $2 ORDER BY created_at DESC,id LIMIT 1", [subscription, `free-base-lock:${subscription}:%`])).rows[0]
  const lapseRow = async (subscription: string) => (await pool.query('SELECT * FROM free_base_locks WHERE subscription_id=$1', [subscription])).rows[0]
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
    await processFreeBaseLocks(pool, { now: at, adapter, subscription_id: f.subscription })
  }
  const failingRunner = (code: string) => async () => { throw new Error(code) }
  const okRunner = async ({ job }: { job: any }) => ({ order_id: job.authority.order_id, tenant_id: job.binding.database, database: job.binding.database,
    target_revision_id: job.authority.target_revision_id, observed_entitlement_digest: job.authority.entitlement.digest, observed_at: beforeEnd.toISOString(), branch_bindings: [], modules_installed: [] })
  /** Enqueues the order's job and runs it with `runner`, as the shared worker would. */
  async function runJob(orderId: string, runner: SubscriptionRunner) {
    await enqueued(orderId)
    const jobId = (await pool.query('SELECT job_id FROM fulfillment_effects WHERE order_id=$1', [orderId])).rows[0].job_id
    return runSubscriptionReconfigure(pool, jobId, runner).catch(e => e)
  }

  type Fixture = Awaited<ReturnType<typeof endedTrial>>
  async function lapse(f: Fixture, at = now) {
    return expireTrials(pool, { now: at, subscription_id: f.subscription })
  }
  async function lock(f: Fixture, at = now) {
    await lower(f, at)
    const order = await lapseOrder(f.subscription)
    expect(await runJob(order.id, okRunner)).toMatchObject({ state: 'verified' })
    await processFreeBaseLocks(pool, { now: at, adapter, subscription_id: f.subscription })
    return order
  }
  async function change(f: Fixture, overrides: Record<string, unknown>, at: Date, pay = true) {
    await freshUsage(f, at)
    const quote = await createQuoteForCustomer(pool, { customer_id: f.customer,
      request: { ...request(), kind: 'change', subscription_id: f.subscription, ...overrides } }, at)
    const input = { quote_id: quote.id, expected_subscription_revision: quote.expected_subscription_revision, idempotency_key: randomUUID() }
    const { order } = await transaction(pool, tx => acceptQuoteOn(tx, input, digestOf(input), quote, f.principal, at))
    await pool.query('UPDATE orders SET created_at=$2 WHERE id=$1', [order.id, at])
    if (pay && quote.due_now.minor > 0) {
      const attempt = await createPaymentAttempt(pool, { order_id: order.id, customer_id: f.customer, adapter, returnOrigin: origin })
      adapter.settle(attempt.provider_ref, 'succeeded')
      expect(await handleProviderEvent(pool, { provider: 'simulator', rawBody: adapter.webhookBody(attempt.provider_ref), headers: {}, adapter }))
        .toMatchObject({ outcome: 'accepted' })
    }
    return { order, quote }
  }
  const beforeEnd = new Date('2026-11-12T09:00:00Z')
  const later = (minutes: number) => new Date(now.getTime() + minutes * 60_000)

  /** Runs `body` with a deletion request of `customer` in `state`, and removes exactly that row afterwards so no other test or file sharing the database sees it. */
  async function withDeletion(customer: string, state: 'deleting' | 'deleted', body: () => Promise<void>) {
    const id = randomUUID()
    await pool.query(`INSERT INTO tenant_deletion_requests(id,customer_id,state,requested_at,requested_by,confirmed_at,confirmed_by,due_at,due_marked_at,hold_until,deleting_at,committed_at,deleted_at,plan,plan_digest,renewal_outcome,renewal_refusal)
      VALUES($1,$2,$3,now(),'t',now(),'t',now(),now(),now(),now(),CASE WHEN $3='deleted' THEN now() END,CASE WHEN $3='deleted' THEN now() END,'{}'::jsonb,$4,'not_cancellable','no_subscription')`,
    [id, customer, state, 'a'.repeat(64)])
    try { await body() } finally { await pool.query('DELETE FROM tenant_deletion_requests WHERE id=$1', [id]) }
  }

  it("lapses a due trial although another customer's workspace is being or has been deleted", async () => {
    const other = await endedTrial()
    for (const state of ['deleting', 'deleted'] as const) {
      const f = await endedTrial()
      await withDeletion(other.customer, state, async () => {
        expect(await lapse(f), state).toMatchObject({ lapsed: [f.subscription] })
      })
      expect((await row(f.subscription)).state, state).not.toBe('trialing')
    }
  })

  it('does not lapse the due trial of a customer whose own workspace is being or has been deleted', async () => {
    for (const state of ['deleting', 'deleted'] as const) {
      const f = await endedTrial()
      await withDeletion(f.customer, state, async () => {
        expect(await lapse(f), state).toEqual({ lapsed: [], deferred: [] })
        expect((await row(f.subscription)).state, state).toBe('trialing')
      })
    }
  })

  it('delivers an unopened signup with app writes locked and starts one clock for its administrator', async () => {
    const f = await endedTrial({}, true, beforeEnd, true)
    const first = (await pool.query('SELECT id FROM orders WHERE subscription_id=$1', [f.subscription])).rows[0].id
    await pool.query(`INSERT INTO public_signup_trials(customer_id,email,mobile,requires_first_login,first_admin_user_id)
      VALUES($1,$2,'+966555077771',true,7)`, [f.customer, `${f.customer}@example.test`])
    expect(await runJob(first, async ({ job }) => {
      expect(Date.parse(job.authority.trial_ends_at!)).toBeLessThan(+beforeEnd)
      expect(job.authority.post_trial_features?.['pmo.enabled']).not.toBe(true)
      return { ...await okRunner({ job }), observed_entitlement_digest: job.authority.post_trial_digest!, root_company_id: 1 }
    })).toMatchObject({ state: 'verified' })
    expect((await row(f.subscription)).trial_ends_at).toBeNull()
    await expect(createQuoteForCustomer(pool, { customer_id: f.customer,
      request: { ...request(), kind: 'change', subscription_id: f.subscription } }, beforeEnd))
      .rejects.toMatchObject({ code: 'trial_awaiting_first_login' })
    await activateSignupTrial(pool, { customerId: f.customer, actorId: '8', now: beforeEnd })
    expect((await row(f.subscription)).trial_ends_at).toBeNull()
    const input = { customerId: f.customer, actorId: '7', now: beforeEnd }
    const end = new Date(+beforeEnd + 14 * 86_400_000).toISOString()
    expect(await Promise.all([activateSignupTrial(pool, input), activateSignupTrial(pool, input)]))
      .toEqual([{ state: 'applying', trial_ends_at: end }, { state: 'applying', trial_ends_at: end }])
    const activate = (await pool.query("SELECT id FROM orders WHERE subscription_id=$1 AND kind='change'", [f.subscription])).rows
    const events = await pool.query("SELECT action FROM audit_events WHERE subject=$1 AND action='trial.started'", [f.customer])
    expect(events.rowCount).toBe(1)
    expect(activate).toHaveLength(1)
    expect(await runJob(activate[0].id, async ({ job }) => {
      expect(job.authority.trial_ends_at).toBe(end)
      expect(job.authority.entitlement.features['pmo.enabled']).toBe(true)
      return okRunner({ job })
    })).toMatchObject({ state: 'verified' })
    expect(await activateSignupTrial(pool, { ...input, now })).toEqual({ state: 'ready', trial_ends_at: end })
  })

  it('locks once under concurrent scans, applies exact limits and never queues a separate expiry clear', async () => {
    const f = await endedTrial({ requested_users: 8, requested_storage_mb: 40960 })
    await Promise.all([lapse(f), lapse(f)])
    expect(await lapseRow(f.subscription)).toMatchObject({ state: 'pending' })
    expect(await getSubscription(pool, f.customer)).toMatchObject({ trial_ends_at: null, trial_outcome: null, pending_free_base_lock: 'trial_end' })
    expect((await pool.query('SELECT 1 FROM shared_jobs WHERE control_tenant_id=$1', [f.tenant])).rowCount).toBe(0)
    await expect(createQuoteForCustomer(pool, { customer_id: f.customer, request: { ...request(), kind: 'change', subscription_id: f.subscription } }, now))
      .rejects.toMatchObject({ code: 'lock_pending' })
    await Promise.all([lower(f), lower(f)])
    const order = await lapseOrder(f.subscription)
    const { job } = await pushed(f.tenant, order.id)
    expect(job).toMatchObject({ origin: 'trial-end', authority: { excess_settle: true, trial_ends_at: null } })
    expect(job.authority.entitlement.features).toMatchObject({ 'users.limit': 3, 'storage.limit_mb': 20480, 'branches.extra_limit': 1, 'pmo.enabled': false })
    for (const key of PAID_KEYS) expect(job.authority.entitlement.features[key]).toBe(false)
    expect(await runJob(order.id, okRunner)).toMatchObject({ state: 'verified' })
    // Of the two concurrent scans, the one that runs after the other has ordered the lock finds the order still in
    // flight and postpones the lapse by LOCK_RETRY_MS; which scan wins is timing. Settle after that window either way.
    await processFreeBaseLocks(pool, { now: new Date(now.getTime() + LOCK_RETRY_MS), subscription_id: f.subscription })
    expect(await row(f.subscription)).toMatchObject({ state: 'active', trial_outcome: 'free_base', trial_ends_at: null })
    expect(await lapseRow(f.subscription)).toMatchObject({ state: 'done', order_seq: 1 })
    expect((await pool.query('SELECT 1 FROM invoices WHERE customer_id=$1', [f.customer])).rowCount).toBe(0)
  })

  it('keeps paid units and one bought app after a zero-due decrease, while the trial-only app locks (L1-L3)', async () => {
    const f = await endedTrial({ requested_storage_mb: 40960 })
    const bought = await change(f, { requested_users: 5, requested_storage_mb: 40960, bundle_revision_ids: [bundle.id, secondBundle.id] }, beforeEnd)
    expect(bought.quote.due_now.minor).toBeGreaterThan(0)
    expect(await runJob(bought.order.id, okRunner)).toMatchObject({ state: 'verified' })
    const reducedAt = new Date('2026-11-13T09:00:00Z')
    await freshUsage(f, reducedAt)
    const reduced = await change(f, { requested_users: 5, requested_storage_mb: 20480, bundle_revision_ids: [bundle.id, secondBundle.id] }, reducedAt)
    expect(reduced.quote.due_now.minor).toBe(0)
    expect(await runJob(reduced.order.id, okRunner)).toMatchObject({ state: 'verified' })
    expect(await trialEndPreview(pool, f.customer, beforeEnd)).toMatchObject({
      status: 'trialing', kept: { paid_users: 2, paid_storage_gb: 0, bundle_revision_ids: [secondBundle.id] },
      locked_bundle_revision_ids: [bundle.id], excess: { item_details: 'unavailable' },
    })
    await lapse(f)
    await lock(f)
    const [first] = await generateRenewals(pool, { now, subscription_id: f.subscription, returnOrigin: origin })
    expect(first?.due_now.minor).toBe(Math.round((2 * 2900 + 19900) * 1.15))
    expect((await getSubscription(pool, f.customer)).applied?.bundle_revision_ids).toEqual([secondBundle.id])
  })

  it('verifies a late paid order against the exact fallback and carries its AI balance through the lock', async () => {
    const f = await endedTrial()
    const purchase = await change(f, { requested_users: 5, ai_topup_minor: 2500 }, beforeEnd)
    await lapse(f)
    const lateRunner = async (input: Parameters<typeof okRunner>[0]) => {
      const authority = input.job.authority
      expect(authority.post_trial_features).toMatchObject({ 'users.limit': 5, 'pmo.enabled': false })
      expect(authority.post_trial_features['ai.balance.granted']).toBeGreaterThan(0)
      expect(authority.post_trial_features['ai.balance.granted']).toBe(authority.entitlement.features['ai.balance.granted'])
      return { ...await okRunner(input), observed_at: now.toISOString(), observed_entitlement_digest: authority.post_trial_digest }
    }
    expect(await runJob(purchase.order.id, lateRunner)).toMatchObject({ state: 'verified' })
    expect((await getSubscription(pool, f.customer)).applied?.entitlement.features['pmo.enabled']).toBe(true)
    await lower(f)
    const order = await lapseOrder(f.subscription)
    const { job } = await pushed(f.tenant, order.id)
    expect(job.authority.entitlement.features['ai.balance.granted']).toBeGreaterThan(0)
    expect(job.authority.entitlement.features['users.limit']).toBe(5)
  })

  it('charges the unpaid whole configuration and only the remaining paid-unit days on early convert (L4)', async () => {
    const f = await endedTrial()
    const bought = await change(f, { requested_users: 5 }, beforeEnd)
    expect(await runJob(bought.order.id, okRunner)).toMatchObject({ state: 'verified' })
    const conversionAt = new Date('2026-11-15T09:00:00Z')
    const converted = await convertTrial(pool, { customer_id: f.customer, now: conversionAt, returnOrigin: origin })
    expect(converted.order?.due_now.minor).toBe(Math.round((19900 + Math.round(5800 * 26 / 30)) * 1.15))
    expect((await getSubscription(pool, f.customer)).state).toBe('trialing')
    expect((await pool.query("SELECT 1 FROM shared_jobs WHERE control_tenant_id=$1 AND payload->>'origin'='trial-end'", [f.tenant])).rowCount).toBe(0)
    const prior = (await getSubscription(pool, f.customer)).applied!.id
    expect(converted.order!.target_revision_id).not.toBe(prior)
    expect(converted.order!.expected_applied_revision_id).toBe(prior)
    const replay = await convertTrial(pool, { customer_id: f.customer, now: conversionAt, returnOrigin: origin })
    expect(replay.order?.id).toBe(converted.order?.id)
    const declined = await openCheckoutPayment(f, converted.order!.id, conversionAt)
    adapter.settle(declined.provider_ref!, 'failed')
    await handleProviderEvent(pool, { provider: 'simulator', rawBody: adapter.webhookBody(declined.provider_ref!), headers: {}, adapter, now: conversionAt })
    expect((await getSubscription(pool, f.customer)).state).toBe('trialing')
    const hosted = await openCheckoutPayment(f, converted.order!.id, conversionAt)
    adapter.settle(hosted.provider_ref!, 'succeeded')
    await handleProviderEvent(pool, { provider: 'simulator', rawBody: adapter.webhookBody(hosted.provider_ref!), headers: {}, adapter, now: conversionAt })
    expect(await runJob(converted.order!.id, async input => {
      expect(input.job.authority).toMatchObject({ previous_revision_id: prior,
        target_revision_id: converted.order!.target_revision_id, trial_ends_at: null,
        entitlement: { features: { 'pmo.enabled': true } } })
      return okRunner(input)
    })).toMatchObject({ state: 'verified' })
    expect(await getSubscription(pool, f.customer)).toMatchObject({ state: 'active', trial_ends_at: null })
    expect(await trialEndPreview(pool, f.customer, conversionAt)).toMatchObject({
      outcome: 'converted', kept: { bundle_revision_ids: [bundle.id], paid_users: 2 },
      locked_bundle_revision_ids: [], limits: { users: 5 },
    })

    await expect(extendTrial(pool, { subscription_id: f.subscription, days: 5, reason: 'Trial reopening', actor: vendor.actor_id, now: conversionAt }))
      .rejects.toMatchObject({ code: 'trial_not_reopenable' })
  })

  it('reopens the original trial policy after the lock, then lapses again once', async () => {
    const f = await endedTrial()
    const original = (await getSubscription(pool, f.customer)).applied!
    await lapse(f)
    const firstLock = await lock(f)
    const at = later(10)
    expect((await getSubscription(pool, f.customer)).trial_reopenable).toBe(true)
    const reopened = await extendTrial(pool, { subscription_id: f.subscription, days: 5, reason: 'Vendor reopened trial', actor: vendor.actor_id, now: at })
    const ordered = (await pool.query('SELECT * FROM orders WHERE subscription_id=$1 AND target_revision_id=(SELECT target_revision_id FROM subscriptions WHERE id=$1)', [f.subscription])).rows[0]
    expect(ordered).toMatchObject({ kind: 'change', expected_applied_revision_id: firstLock.target_revision_id,
      due_now_minor: '0', payment_state: 'not_required' })
    expect(ordered.target_revision_id).not.toBe(original.id)
    expect(await runJob(ordered.id, async input => {
      expect(input.job.authority).toMatchObject({ trial_ends_at: new Date(reopened.trial_ends_at).toISOString(),
        entitlement: { features: { 'pmo.enabled': true } }, post_trial_features: { 'pmo.enabled': false } })
      return okRunner(input)
    })).toMatchObject({ state: 'verified' })
    expect(await getSubscription(pool, f.customer)).toMatchObject({ state: 'trialing', trial_outcome: null, pending_free_base_lock: null })
    expect((await getSubscription(pool, f.customer)).applied?.bundle_revision_ids).toEqual([bundle.id])
    const newEnd = new Date(reopened.trial_ends_at)
    await lapse(f, newEnd)
    await lock(f, newEnd)
    expect(await lapseRow(f.subscription)).toMatchObject({ state: 'done', order_seq: 2 })
    expect((await pool.query('SELECT 1 FROM invoices WHERE customer_id=$1', [f.customer])).rowCount).toBe(0)
  })

  it('voids a reopened trial’s unpaid invoice and returns a late capture without losing paid trial units', async () => {
    const f = await endedTrial()
    const paid = await change(f, { requested_users: 5 }, beforeEnd)
    expect(await runJob(paid.order.id, okRunner)).toMatchObject({ state: 'verified' })
    await lapse(f)
    await lock(f)
    const [invoiceOrder] = await generateRenewals(pool, { now, subscription_id: f.subscription, returnOrigin: origin })
    const { provider_ref } = await createPaymentAttempt(pool, { order_id: invoiceOrder!.id, customer_id: f.customer, adapter, returnOrigin: origin })
    await extendTrial(pool, { subscription_id: f.subscription, days: 5, reason: 'Vendor reopened trial', actor: vendor.actor_id, now })
    expect((await pool.query('SELECT status FROM invoices WHERE order_id=$1', [invoiceOrder!.id])).rows[0].status).toBe('void')
    adapter.settle(provider_ref, 'succeeded')
    await handleProviderEvent(pool, { provider: 'simulator', rawBody: adapter.webhookBody(provider_ref), headers: {}, adapter })
    await processRefundOutbox(pool, adapter)
    expect((await pool.query('SELECT payment_state FROM orders WHERE id=$1', [invoiceOrder!.id])).rows[0].payment_state).toBe('refunded')
    const pending = (await getSubscription(pool, f.customer)).pending_order!
    expect(await runJob(pending.id, okRunner)).toMatchObject({ state: 'verified' })
    expect(await trialEndPreview(pool, f.customer, now)).toMatchObject({ kept: { paid_users: 2 } })
  })

  it('issues a fresh payable renewal when a reopened trial converts in the same Riyadh day', async () => {
    const at = new Date('2026-11-19T10:00:00Z')
    const f = await endedTrial()
    const paid = await change(f, { requested_users: 5 }, beforeEnd)
    expect(await runJob(paid.order.id, okRunner)).toMatchObject({ state: 'verified' })
    await lapse(f, at)
    await lock(f, at)
    const [oldOrder] = await generateRenewals(pool, { now: at, subscription_id: f.subscription, returnOrigin: origin })
    expect(oldOrder?.id).toBeTruthy()
    await extendTrial(pool, { subscription_id: f.subscription, days: 5, reason: 'Vendor reopened trial', actor: vendor.actor_id, now: at })
    const pending = (await getSubscription(pool, f.customer)).pending_order!
    expect(await runJob(pending.id, okRunner)).toMatchObject({ state: 'verified' })

    const conversion = await convertTrial(pool, { customer_id: f.customer, now: new Date('2026-11-19T11:00:00Z'), returnOrigin: origin })
    expect(conversion.pending).toBe(false)
    expect(conversion.order?.id).not.toBe(oldOrder!.id)
    const rows = (await pool.query(`SELECT r.order_id,i.status FROM renewals r JOIN invoices i ON i.id=r.invoice_id
      WHERE r.subscription_id=$1 AND r.period_start='2026-11-19' ORDER BY r.created_at`, [f.subscription])).rows
    expect(rows).toEqual([{ order_id: oldOrder!.id, status: 'void' }, { order_id: conversion.order!.id, status: 'issued' }])
  })

  it('voids an open checkout at expiry, and refunds a late successful capture', async () => {
    const f = await endedTrial()
    const conversionAt = new Date('2026-11-18T11:00:00Z')
    const conversion = await convertTrial(pool, { customer_id: f.customer, now: conversionAt, returnOrigin: origin })
    const order = conversion.order!
    const attempt = await createPaymentAttempt(pool, { order_id: order.id, customer_id: f.customer, adapter, returnOrigin: origin, now: conversionAt })
    expect((await getSubscription(pool, f.customer)).state).toBe('trialing')
    await lapse(f)
    adapter.settle(attempt.provider_ref!, 'succeeded')
    await handleProviderEvent(pool, { provider: 'simulator', rawBody: adapter.webhookBody(attempt.provider_ref!), headers: {}, adapter, now })
    expect((await pool.query('SELECT cancelled,payment_state FROM orders WHERE id=$1', [order.id])).rows[0])
      .toMatchObject({ cancelled: true, payment_state: 'refund_pending' })
    expect((await row(f.subscription)).trial_outcome).not.toBe('converted')
    expect(await lapseRow(f.subscription)).toMatchObject({ state: 'pending', cause: 'trial_end' })
  })

  /** Opens a checkout payment at `openedAt`, as the database would have stamped it then. */
  async function openCheckoutPayment(f: Fixture, orderId: string, openedAt: Date) {
    const attempt = await createPaymentAttempt(pool, { order_id: orderId, customer_id: f.customer, adapter, returnOrigin: origin, now: openedAt })
    await pool.query('UPDATE payment_attempts SET created_at=$2 WHERE id=$1', [attempt.id, openedAt])
    return attempt
  }
  async function capture(providerRef: string, at: Date) {
    adapter.settle(providerRef, 'succeeded')
    await handleProviderEvent(pool, { provider: 'simulator', rawBody: adapter.webhookBody(providerRef), headers: {}, adapter, now: at })
  }
  const orderRow = async (id: string) => (await pool.query('SELECT cancelled,payment_state FROM orders WHERE id=$1', [id])).rows[0]

  it('reissues a checkout the next day, refunds a late capture of the first one and keeps the new one payable', async () => {
    const f = await endedTrial()
    const dayOne = new Date('2026-11-17T10:00:00Z'), dayTwo = new Date('2026-11-18T10:00:00Z')
    const first = (await convertTrial(pool, { customer_id: f.customer, now: dayOne, returnOrigin: origin })).order!
    await expect(cancelOrder(pool, { order_id: first.id, principal: f.principal, reason: 'Changed my mind' }))
      .rejects.toMatchObject({ code: 'order_not_cancellable' })
    const late = await openCheckoutPayment(f, first.id, dayOne)
    const second = (await convertTrial(pool, { customer_id: f.customer, now: dayTwo, returnOrigin: origin })).order!
    expect(second.id).not.toBe(first.id)
    await capture(late.provider_ref!, dayTwo)
    expect(await orderRow(first.id)).toMatchObject({ cancelled: true, payment_state: 'refund_pending' })
    expect(await row(f.subscription)).toMatchObject({ state: 'trialing', target_revision_id: second.target_revision_id })
    const fresh = await openCheckoutPayment(f, second.id, dayTwo)
    await capture(fresh.provider_ref!, dayTwo)
    expect(await orderRow(second.id)).toMatchObject({ cancelled: false, payment_state: 'paid' })
    expect(await row(f.subscription)).toMatchObject({ state: 'active', trial_outcome: 'converted' })
  })

  it('settles a payment opened before Riyadh midnight and captured after it, and refuses one opened after it', async () => {
    const before = new Date('2026-11-17T20:55:00Z'), after = new Date('2026-11-17T21:02:00Z')
    const f = await endedTrial()
    const order = (await convertTrial(pool, { customer_id: f.customer, now: new Date('2026-11-17T20:50:00Z'), returnOrigin: origin })).order!
    const attempt = await openCheckoutPayment(f, order.id, before)
    await capture(attempt.provider_ref!, after)
    expect(await orderRow(order.id)).toMatchObject({ cancelled: false, payment_state: 'paid' })
    expect((await row(f.subscription)).state).toBe('active')

    const g = await endedTrial()
    const other = (await convertTrial(pool, { customer_id: g.customer, now: new Date('2026-11-17T20:50:00Z'), returnOrigin: origin })).order!
    await expect(createPaymentAttempt(pool, { order_id: other.id, customer_id: g.customer, adapter, returnOrigin: origin, now: after }))
      .rejects.toMatchObject({ code: 'trial_checkout_expired' })
    const stale = await openCheckoutPayment(g, other.id, before)
    await pool.query('UPDATE payment_attempts SET created_at=$2 WHERE id=$1', [stale.id, after])
    await capture(stale.provider_ref!, after)
    expect(await orderRow(other.id)).toMatchObject({ cancelled: true, payment_state: 'refund_pending' })
    expect((await row(g.subscription)).state).toBe('trialing')
  })

  it('lifts the trial deadline on the host at payment, so a fulfilment after the deadline never cuts the payer', async () => {
    const f = await endedTrial()
    const paidAt = new Date('2026-11-19T08:50:00Z'), pastDeadline = new Date('2026-11-19T09:30:00Z')
    const order = (await convertTrial(pool, { customer_id: f.customer, now: paidAt, returnOrigin: origin })).order!
    await capture((await openCheckoutPayment(f, order.id, paidAt)).provider_ref!, paidAt)
    const lift = (await pool.query(`SELECT payload FROM shared_jobs WHERE control_tenant_id=$1 AND payload->>'origin'='trial-end'
      ORDER BY created_at DESC LIMIT 1`, [f.tenant])).rows[0]?.payload
    expect(lift?.authority).toMatchObject({ trial_ends_at: null, commercial_valid_until: null })
    expect(lift.authority.target_revision_id).not.toBe(order.target_revision_id)
    expect((await pool.query("SELECT actor,reason FROM audit_events WHERE action='trial.converted' AND subject=$1", [f.subscription])).rows)
      .toEqual([{ actor: 'system:payment', reason: 'First paid period confirmed' }])
    expect((await lapse(f, pastDeadline)).lapsed).toEqual([])
    expect(await runJob(order.id, async input => {
      expect(input.job.authority).toMatchObject({ trial_ends_at: null, commercial_valid_until: null })
      return okRunner(input)
    })).toMatchObject({ state: 'verified' })
    expect(await getSubscription(pool, f.customer)).toMatchObject({ state: 'active', trial_ends_at: null })
  })

  it('records a failed deadline lift and still settles the payment', async () => {
    const f = await endedTrial()
    const paidAt = new Date('2026-11-18T10:00:00Z')
    const order = (await convertTrial(pool, { customer_id: f.customer, now: paidAt, returnOrigin: origin })).order!
    const attempt = await openCheckoutPayment(f, order.id, paidAt)
    // A deadline push already running on the host holds the tenant's one open trial-end job.
    await extendTrial(pool, { subscription_id: f.subscription, days: 1, reason: 'Vendor goodwill', actor: vendor.actor_id, now: paidAt })
    await pool.query("UPDATE shared_jobs SET state='running' WHERE control_tenant_id=$1 AND payload->>'origin'='trial-end' AND state='queued'", [f.tenant])
    await capture(attempt.provider_ref!, paidAt)
    expect(await orderRow(order.id)).toMatchObject({ cancelled: false, payment_state: 'paid' })
    expect(await row(f.subscription)).toMatchObject({ state: 'active', trial_outcome: 'converted' })
    expect((await pool.query("SELECT status FROM commercial_outbox WHERE kind='fulfillment.enqueue' AND aggregate_id=$1", [order.id])).rows).toEqual([{ status: 'pending' }])
    expect((await pool.query("SELECT reason FROM audit_events WHERE action='trial.expiry_push_failed' AND subject=$1", [f.subscription])).rows)
      .toEqual([{ reason: '23505' }])
  })

  it('aborts the settlement when the deadline lift fails for a reason that is not operational', async () => {
    const f = await endedTrial()
    const paidAt = new Date('2026-11-18T10:00:00Z')
    const order = (await convertTrial(pool, { customer_id: f.customer, now: paidAt, returnOrigin: origin })).order!
    const attempt = await openCheckoutPayment(f, order.id, paidAt)
    vi.mocked(pushCommercialExpiry).mockRejectedValueOnce(new TypeError('push bug'))
    adapter.settle(attempt.provider_ref!, 'succeeded')
    await expect(handleProviderEvent(pool, { provider: 'simulator', rawBody: adapter.webhookBody(attempt.provider_ref!), headers: {}, adapter, now: paidAt }))
      .rejects.toBeInstanceOf(TypeError)
    expect(await orderRow(order.id)).toMatchObject({ cancelled: false, payment_state: 'awaiting_payment' })
    expect((await row(f.subscription)).state).toBe('trialing')
    expect((await pool.query("SELECT 1 FROM audit_events WHERE action='trial.expiry_push_failed' AND subject=$1", [f.subscription])).rowCount).toBe(0)
  })

  /** Pays a checkout opened at `at`, then refunds it at the provider before anything is delivered. */
  async function payThenRefund(f: Fixture, at: Date) {
    const order = (await convertTrial(pool, { customer_id: f.customer, now: at, returnOrigin: origin })).order!
    const attempt = await openCheckoutPayment(f, order.id, at)
    await capture(attempt.provider_ref!, at)
    await adapter.refund((await adapter.lookupAttempt(attempt.provider_ref!)).payment_id!)
    await handleProviderEvent(pool, { provider: 'simulator', rawBody: adapter.webhookBody(attempt.provider_ref!), headers: {}, adapter, now: at })
    return order
  }

  it('returns a checkout refunded before delivery to the running trial, which can pay again the same day', async () => {
    const f = await endedTrial()
    const at = new Date('2026-11-18T10:00:00Z')
    const deadline = (await row(f.subscription)).trial_ends_at
    const today = { from: riyadhDate(new Date()), to: riyadhDate(new Date()) }
    const collected = async () => {
      const figure = (await getAnalytics(pool, today)).current.collection.collected
      return figure.available ? figure.value.minor : 0
    }
    await processRefundOutbox(pool)
    const before = await collected()
    const order = await payThenRefund(f, at)
    expect(await orderRow(order.id)).toMatchObject({ cancelled: true, payment_state: 'refunded' })
    await processRefundOutbox(pool)
    const invoice = await invoiceOf(order.id)
    expect(invoice.status).toBe('credit_pending')
    expect((await pool.query("SELECT amount_minor,status,cause FROM invoice_adjustments WHERE invoice_id=$1 AND kind='credit_note'", [invoice.id])).rows)
      .toEqual([{ amount_minor: invoice.total_minor, status: 'pending', cause: 'provider_refund' }])
    // Collection and the signup funnel count only invoices still `paid`: the refunded checkout adds nothing to either.
    expect(await collected()).toBe(before)
    expect(await row(f.subscription)).toMatchObject({ state: 'trialing', trial_outcome: null, trial_ended_at: null, target_revision_id: null, trial_ends_at: deadline })
    expect((await pool.query('SELECT status FROM renewals WHERE order_id=$1', [order.id])).rows).toEqual([{ status: 'superseded' }])
    expect((await pool.query("SELECT status,payload->>'error' AS error FROM commercial_outbox WHERE kind='fulfillment.enqueue' AND aggregate_id=$1", [order.id])).rows)
      .toEqual([{ status: 'failed', error: 'trial_checkout_refunded' }])
    expect((await pool.query("SELECT actor FROM audit_events WHERE action='trial.conversion_reverted' AND subject=$1 AND metadata->>'order_id'=$2", [f.subscription, order.id])).rows)
      .toEqual([{ actor: 'system:payment' }])
    // The customer is told once that the payment came back and that the trial runs to its original day.
    const refundNotice = (await pool.query("SELECT payload FROM commercial_outbox WHERE kind='billing.notice' AND aggregate_id=$1 AND payload->>'type'='payment_refunded'", [f.subscription])).rows
    expect(refundNotice).toHaveLength(1)
    expect(refundNotice[0].payload).toMatchObject({ type: 'payment_refunded', invoice_id: invoice.id, trial_reverted: true, amount: { minor: Number(invoice.total_minor), currency: 'SAR' } })
    const sentRefund: any[] = []
    await sendBillingNotices(pool, { now: at, mail: { send: async (m: any) => { sentRefund.push(m); return { accepted: true, provider_message_id: 'p' } } } as any, returnOrigin: origin })
    const refundMail = sentRefund.find(m => m.subject === 'استرددنا دفعتك في LiwanOS')
    expect(refundMail.text).toContain(`تجربتك مستمرة حتى ${riyadhDate(new Date(deadline))}`)
    expect(refundMail.text).toContain(`Your trial continues until ${riyadhDate(new Date(deadline))}`)
    const restore = (await pool.query(`SELECT payload FROM shared_jobs WHERE control_tenant_id=$1 AND payload->>'origin'='trial-end' AND state='queued'`, [f.tenant])).rows
    expect(restore).toHaveLength(1)
    expect(new Date(restore[0].payload.authority.trial_ends_at).getTime()).toBe(new Date(deadline).getTime())

    const again = (await convertTrial(pool, { customer_id: f.customer, now: at, returnOrigin: origin })).order!
    expect(again.id).not.toBe(order.id)
    await capture((await openCheckoutPayment(f, again.id, at)).provider_ref!, at)
    expect(await row(f.subscription)).toMatchObject({ state: 'active', trial_outcome: 'converted', target_revision_id: again.target_revision_id })
  })

  it('lapses a trial whose checkout was refunded before delivery at its deadline, like any unpaid trial', async () => {
    const f = await endedTrial()
    await payThenRefund(f, new Date('2026-11-18T10:00:00Z'))
    expect((await lapse(f, new Date('2026-11-19T09:30:00Z'))).lapsed).toEqual([f.subscription])
    expect(await lapseRow(f.subscription)).toMatchObject({ state: 'pending', cause: 'trial_end' })
  })

  it('converts a checkout that owes nothing at once, queues its fulfilment and audits the customer', async () => {
    const f = await endedTrial({ bundle_revision_ids: [] })
    const order = (await convertTrial(pool, { customer_id: f.customer, now: beforeEnd, returnOrigin: origin })).order!
    expect(order).toMatchObject({ payment_state: 'not_required', fulfillment_state: 'queued' })
    expect(await row(f.subscription)).toMatchObject({ state: 'active', trial_outcome: 'converted' })
    expect((await pool.query("SELECT 1 FROM commercial_outbox WHERE kind='fulfillment.enqueue' AND aggregate_id=$1", [order.id])).rowCount).toBe(1)
    expect((await pool.query("SELECT actor,reason FROM audit_events WHERE action='trial.converted' AND subject=$1", [f.subscription])).rows)
      .toEqual([{ actor: `customer:${f.customer}`, reason: 'First paid period already covered; nothing was charged' }])
  })

  it('cancels an unpaid order so the lock can proceed; a late paid receipt does not reopen the trial (L5)', async () => {
    const f = await endedTrial()
    const pending = await change(f, { requested_users: 5 }, beforeEnd, false)
    const attempt = await createPaymentAttempt(pool, { order_id: pending.order.id, customer_id: f.customer, adapter, returnOrigin: origin })
    await lapse(f)
    await lock(f)
    expect((await pool.query('SELECT cancelled,automatic_refund FROM orders WHERE id=$1', [pending.order.id])).rows[0])
      .toEqual({ cancelled: true, automatic_refund: true })
    adapter.settle(attempt.provider_ref, 'succeeded')
    await handleProviderEvent(pool, { provider: 'simulator', rawBody: adapter.webhookBody(attempt.provider_ref), headers: {}, adapter })
    await processRefundOutbox(pool, adapter)
    expect((await pool.query('SELECT payment_state FROM orders WHERE id=$1', [pending.order.id])).rows[0].payment_state).toBe('refunded')
    expect((await getSubscription(pool, f.customer)).trial_outcome).toBe('free_base')
  })

  it('makes a paid undeliverable order whole once after bounded retries (L9)', async () => {
    const f = await endedTrial()
    const paid = await change(f, { requested_users: 5 }, beforeEnd)
    const orderId = paid.order.id
    await lapse(f)
    expect(await runJob(orderId, failingRunner('observed_mismatch'))).toMatchObject({ message: 'observed_mismatch' })
    await processFreeBaseLocks(pool, { now, subscription_id: f.subscription })
    expect(await lapseOrder(f.subscription)).toBeUndefined()
    for (let n = 0; n < 3; n++) {
      await recoverPaidFulfillment(pool, later(120))
      const retry = (await pool.query('SELECT fulfillment_retries,fulfillment_state FROM orders WHERE id=$1', [orderId])).rows[0]
      expect(retry).toEqual({ fulfillment_retries: n + 1, fulfillment_state: 'queued' })
      expect(await runJob(orderId, failingRunner('observed_mismatch'))).toMatchObject({ message: 'observed_mismatch' })
    }
    await recoverPaidFulfillment(pool, later(120))
    const refund = vi.spyOn(adapter, 'refund')
    await processRefundOutbox(pool, adapter)
    await processRefundOutbox(pool, adapter)
    expect(refund).toHaveBeenCalledTimes(1)
    refund.mockRestore()
    expect((await pool.query('SELECT payment_state,cancelled FROM orders WHERE id=$1', [orderId])).rows[0])
      .toEqual({ payment_state: 'refunded', cancelled: true })
    expect((await pool.query('SELECT ia.status FROM invoice_adjustments ia JOIN invoices i ON i.id=ia.invoice_id WHERE i.order_id=$1', [orderId])).rows)
      .toEqual([{ status: 'refunded' }])
    await lock(f, later(120))
    expect((await getSubscription(pool, f.customer)).trial_outcome).toBe('free_base')
  })

  it('requeues a system job that may have written (T8)', async () => {
    const f = await endedTrial()
    await lapse(f)
    await lower(f)
    const order = await lapseOrder(f.subscription)
    await expect(runJob(order.id, failingRunner('observed_mismatch'))).resolves.toMatchObject({ message: 'observed_mismatch' })
    await recoverCommercialSystemJobs(pool, now)
    await recoverCommercialSystemJobs(pool, later(5))
    expect(await runJob(order.id, okRunner)).toMatchObject({ state: 'verified' })
    await processFreeBaseLocks(pool, { now, subscription_id: f.subscription })
    expect(await lapseRow(f.subscription)).toMatchObject({ state: 'done' })
  })

  it('retires a stale system date push once the target revision moves (T8)', async () => {
    const f = await endedTrial()
    await transaction(pool, tx => pushCommercialExpiry(tx, f.subscription, new Date('2026-11-19T09:00:00Z')))
    const dateJob = (await pool.query("SELECT id FROM shared_jobs WHERE control_tenant_id=$1 AND payload->>'origin'='trial-end'", [f.tenant])).rows[0]
    const bought = await change(f, { requested_users: 5 }, beforeEnd)
    expect(await runJob(bought.order.id, okRunner)).toMatchObject({ state: 'verified' })
    await expect(runSubscriptionReconfigure(pool, dateJob.id, okRunner)).rejects.toThrow('stale_target')
    await recoverCommercialSystemJobs(pool, now)
    expect((await pool.query('SELECT state FROM shared_jobs WHERE id=$1', [dateJob.id])).rows[0].state).toBe('failed')
    await lapse(f)
    await lock(f)
  })

  it('releases a failed zero-due trial order without issuing a refund', async () => {
    const f = await endedTrial()
    const free = await change(f, {}, beforeEnd)
    expect(free.quote.due_now.minor).toBe(0)
    await lapse(f)
    await pool.query("UPDATE orders SET fulfillment_state='failed',fulfillment_retries=3 WHERE id=$1", [free.order.id])
    await recoverPaidFulfillment(pool, now)
    expect((await pool.query('SELECT payment_state,cancelled FROM orders WHERE id=$1', [free.order.id])).rows[0])
      .toEqual({ payment_state: 'not_required', cancelled: true })
    expect((await pool.query("SELECT id FROM commercial_outbox WHERE aggregate_id=$1 AND kind='reconcile.refund'", [free.order.id])).rowCount).toBe(0)
    await lock(f)
  })

  it('authorizes only exact unacknowledged predecessors after bounded post-write recovery', async () => {
    const f = await endedTrial()
    const earlierPaid = await change(f, { requested_users: 4 }, beforeEnd)
    const unrelated = await pushed(f.tenant, earlierPaid.order.id)
    expect(await runJob(earlierPaid.order.id, okRunner)).toMatchObject({ state: 'verified' })
    const laterPaid = await change(f, { requested_users: 5 }, new Date(beforeEnd.getTime()+86_400_000))
    expect(await runJob(laterPaid.order.id, okRunner)).toMatchObject({ state: 'verified' })
    await lapse(f)
    await lower(f)
    const original = await lapseOrder(f.subscription)
    const first = await pushed(f.tenant, original.id)
    // The first host write committed, then the connection lost its receipt.
    const installed = { revision_id: original.target_revision_id, digest: first.job.authority.entitlement.digest }
    expect(await runJob(original.id, failingRunner('shared_effect_unverified'))).toMatchObject({ message: 'shared_effect_unverified' })
    let minutes = 0
    for (const delay of [5, 15, 60, 180, 360]) {
      await recoverCommercialSystemJobs(pool, later(minutes))
      minutes += delay
      await recoverCommercialSystemJobs(pool, later(minutes))
      const error = delay === 360 ? 'tenant_binding_mismatch' : 'shared_effect_unverified'
      expect(await runJob(original.id, failingRunner(error))).toMatchObject({ message: error })
    }
    await recoverCommercialSystemJobs(pool, later(minutes))
    await processFreeBaseLocks(pool, { now: later(minutes), subscription_id: f.subscription })
    minutes += 5
    await lower(f, later(minutes))
    const second = await lapseOrder(f.subscription)
    expect(second.id).not.toBe(original.id)
    // This replacement is refused before a write, so the first revision remains the actual Odoo predecessor.
    expect(await runJob(second.id, failingRunner('tenant_binding_mismatch'))).toMatchObject({ message: 'tenant_binding_mismatch' })
    await recoverCommercialSystemJobs(pool, later(minutes))
    await processFreeBaseLocks(pool, { now: later(minutes), subscription_id: f.subscription })
    minutes += 5
    await lower(f, later(minutes))
    const third = await lapseOrder(f.subscription)
    const candidate = await pushed(f.tenant, third.id)
    expect(candidate.job.authority.recoverable_predecessors).toEqual([installed])
    await expect(transaction(pool, client => assertReconfigureAuthority(client, {
      ...candidate.job, authority: { ...candidate.job.authority,
        recoverable_predecessors: [{ revision_id: earlierPaid.order.target_revision_id, digest: unrelated.job.authority.entitlement.digest }] },
    }))).rejects.toThrow('recovery_predecessor_invalid')
    expect(await runJob(third.id, okRunner)).toMatchObject({ state: 'verified' })
    await processFreeBaseLocks(pool, { now: later(minutes), subscription_id: f.subscription })
    expect(await lapseRow(f.subscription)).toMatchObject({ state: 'done', order_seq: 3 })
  })

  it('returns an unpaid kept subset to free base after first invoice grace (T9)', async () => {
    const f = await endedTrial()
    const paid = await change(f, { requested_users: 5 }, beforeEnd)
    expect(await runJob(paid.order.id, okRunner)).toMatchObject({ state: 'verified' })
    await lapse(f)
    await lock(f)
    const [first] = await generateRenewals(pool, { now, subscription_id: f.subscription, returnOrigin: origin })
    await pool.query("UPDATE payment_attempts SET status='failed' WHERE order_id=$1", [first!.id])
    const deadline = new Date(Math.max(now.getTime(), Date.now()) + 8 * 86_400_000)
    await applyDunning(pool, { now: deadline })
    expect(await lapseRow(f.subscription)).toMatchObject({ state: 'pending', cause: 'first_invoice_unpaid' })
    expect((await pool.query('SELECT status FROM invoices WHERE order_id=$1', [first!.id])).rows[0].status).toBe('void')
    await lock(f, deadline)
    expect(await row(f.subscription)).toMatchObject({ state: 'active', manual_suspension: false, trial_outcome: 'free_base' })
  })

  it('resumes a manually suspended overdue trial through lapse and preserves suspension during lock (T10)', async () => {
    const f = await endedTrial()
    const input = { subscription_id: f.subscription, reason: 'operator hold', actor: vendor.actor_id }
    await suspendSubscription(pool, input)
    expect(await lapse(f)).toMatchObject({ lapsed: [] })
    await resumeSubscription(pool, input)
    expect(await row(f.subscription)).toMatchObject({ state: 'trialing' })
    await lapse(f)
    await suspendSubscription(pool, input)
    await lock(f)
    const pushed: string[] = []
    await syncTenantStatus(pool, { limit: 100, runner: async v => { if (v.tenant_id === f.tenant) pushed.push(v.status) } })
    expect(await row(f.subscription)).toMatchObject({ state: 'suspended', manual_suspension: true })
    expect(pushed).toEqual(['suspended'])
  })

  it.each([null, false])('defers without writing when post_trial_supported=%s (T11)', async supported => {
    const f = await endedTrial()
    await pool.query('UPDATE tenants SET post_trial_supported=$2 WHERE id=$1', [f.tenant, supported])
    const original = await row(f.subscription)
    expect(await lapse(f)).toMatchObject({ deferred: [f.subscription] })
    expect(await row(f.subscription)).toEqual(original)
    expect(await lapseRow(f.subscription)).toBeUndefined()
  })

  it('installs the fallback for an existing trial before its capability flags unlock lapse', async () => {
    const f = await endedTrial()
    await pool.query('UPDATE tenants SET post_trial_supported=NULL,excess_supported=NULL WHERE id=$1', [f.tenant])
    const binding = (await pool.query('SELECT database_name FROM shared_registry_bindings WHERE control_tenant_id=$1', [f.tenant])).rows[0]
    const usage = { 'users.limit': 3, 'storage.limit_mb': 0, 'branches.extra_limit': 0 }
    const observe = async (overLimitStorageBytes?: number) => collectUsage(pool, { limit: 100, runner: async input => input.tenant_id === f.tenant ? {
      database: binding.database_name, observed_at: new Date().toISOString(), usage,
      limit_gates: Object.fromEntries(Object.keys(usage).map(key => [key, []])),
      post_trial_supported: true, excess_supported: true, storage_bytes: 20480 * 1024 * 1024 + 17,
      ...(overLimitStorageBytes === undefined ? {} : { over_limit_storage_bytes: overLimitStorageBytes }),
    } : null })
    const previous = await row(f.subscription)
    await observe()
    await observe()
    expect(await lapse(f)).toMatchObject({ deferred: [f.subscription] })
    expect(await trialEndPreview(pool, f.customer)).toMatchObject({ excess: { storage_bytes: 17, source: 'usage_snapshot' } })
    const bootstrap = (await getSubscription(pool, f.customer)).pending_order
    expect(bootstrap).toMatchObject({
      expected_applied_revision_id: previous.applied_revision_id, payment_state: 'not_required', due_now: { minor: 0 },
    })
    expect(bootstrap!.target_revision_id).not.toBe(previous.applied_revision_id)
    expect((await pool.query("SELECT id FROM orders WHERE subscription_id=$1 AND idempotency_key LIKE 'trial-bootstrap:%'", [f.subscription])).rowCount).toBe(1)
    expect(await row(f.subscription)).toMatchObject({ state: 'trialing', trial_ends_at: previous.trial_ends_at })
    await expect(extendTrial(pool, { subscription_id: f.subscription, now: beforeEnd, days: 5, reason: 'While priming', actor: vendor.actor_id }))
      .rejects.toMatchObject({ code: 'subscription_change_pending' })
    expect(await runJob(bootstrap!.id, async input => {
      expect(input.job.authority).toMatchObject({
        trial_ends_at: previous.trial_ends_at.toISOString(), previous_revision_id: previous.applied_revision_id,
        target_revision_id: bootstrap!.target_revision_id,
        entitlement: { features: { 'pmo.enabled': true } }, post_trial_features: { 'pmo.enabled': false },
      })
      return { ...await okRunner(input), post_trial_supported: true, excess_supported: true }
    })).toMatchObject({ state: 'verified' })
    expect(await lapse(f)).toMatchObject({ lapsed: [f.subscription] })
    await processFreeBaseLocks(pool, { now, adapter, subscription_id: f.subscription })
    expect(await runJob((await lapseOrder(f.subscription)).id, okRunner)).toMatchObject({ state: 'verified' })
    await processFreeBaseLocks(pool, { now, adapter, subscription_id: f.subscription })
    expect(await trialEndPreview(pool, f.customer)).toMatchObject({ excess: { storage_bytes: null } })
    await observe(33)
    expect(await trialEndPreview(pool, f.customer)).toMatchObject({ excess: { storage_bytes: 33, source: 'usage_snapshot' } })
  })

  it('leaves an accepted trial target in charge of delivering the fallback', async () => {
    const f = await endedTrial()
    const pending = await change(f, {}, beforeEnd)
    await pool.query('UPDATE tenants SET post_trial_supported=NULL,excess_supported=NULL WHERE id=$1', [f.tenant])
    const binding = (await pool.query('SELECT database_name FROM shared_registry_bindings WHERE control_tenant_id=$1', [f.tenant])).rows[0]
    const usage = { 'users.limit': 3, 'storage.limit_mb': 0, 'branches.extra_limit': 0 }
    await collectUsage(pool, { limit: 100, runner: async input => input.tenant_id === f.tenant ? {
      database: binding.database_name, observed_at: new Date().toISOString(), usage,
      limit_gates: Object.fromEntries(Object.keys(usage).map(key => [key, []])),
      post_trial_supported: true, excess_supported: true,
    } : null })
    expect(await row(f.subscription)).toMatchObject({ target_revision_id: pending.order.target_revision_id })
    expect((await pool.query("SELECT 1 FROM orders WHERE subscription_id=$1 AND idempotency_key LIKE 'trial-bootstrap:%'", [f.subscription])).rowCount).toBe(0)
    expect(await lapse(f)).toMatchObject({ deferred: [f.subscription] })
  })

  it('primes a manually suspended legacy trial without collecting its usage or lifting suspension', async () => {
    const f = await endedTrial()
    await pool.query('UPDATE tenants SET post_trial_supported=NULL,excess_supported=NULL WHERE id=$1', [f.tenant])
    await suspendSubscription(pool, { subscription_id: f.subscription, reason: 'Manual hold during rollout', actor: vendor.actor_id })
    const previous = await row(f.subscription)
    const binding = (await pool.query('SELECT database_name FROM shared_registry_bindings WHERE control_tenant_id=$1', [f.tenant])).rows[0]
    const usage = { 'users.limit': 3, 'storage.limit_mb': 0, 'branches.extra_limit': 0 }
    await collectUsage(pool, { limit: 100, runner: async input => input.tenant_id === f.tenant ? {
      database: binding.database_name, observed_at: new Date().toISOString(), usage,
      limit_gates: Object.fromEntries(Object.keys(usage).map(key => [key, []])),
      post_trial_supported: true, excess_supported: true,
    } : null })
    expect((await pool.query('SELECT 1 FROM usage_snapshots WHERE tenant_id=$1', [f.tenant])).rowCount).toBe(0)
    const bootstrap = (await getSubscription(pool, f.customer)).pending_order!
    expect(bootstrap?.expected_applied_revision_id).toBe(previous.applied_revision_id)
    expect(await runJob(bootstrap.id, async input => ({
      ...await okRunner(input), post_trial_supported: true, excess_supported: true,
    }))).toMatchObject({ state: 'verified' })
    expect(await row(f.subscription)).toMatchObject({
      state: 'suspended', suspended_from: 'trialing', manual_suspension: true, trial_ends_at: previous.trial_ends_at,
    })
  })

  it('rolls back expiry and its lapse together if the transaction crashes (T12)', async () => {
    const f = await endedTrial()
    const original = await row(f.subscription)
    await expect(transaction(pool, async client => {
      expect(await endTrialOn(client, f.subscription, { now })).toBe('lapsed')
      throw Error('simulated crash')
    })).rejects.toThrow('simulated crash')
    expect(await row(f.subscription)).toEqual(original)
    expect(await lapseRow(f.subscription)).toBeUndefined()
  })

  it('keeps working after one poisoned lapse (T13)', async () => {
    const bad = await endedTrial(), good = await endedTrial()
    await lapse(bad)
    await lapse(good)
    const badRow = await row(bad.subscription)
    await pool.query('ALTER TABLE subscription_revisions DISABLE TRIGGER USER')
    try {
      await pool.query("UPDATE subscription_revisions SET snapshot=jsonb_set(snapshot,'{plan_revision_id}',to_jsonb($2::text)) WHERE id=$1",
        [badRow.applied_revision_id, randomUUID()])
    } finally { await pool.query('ALTER TABLE subscription_revisions ENABLE TRIGGER USER') }
    await expect(processFreeBaseLocks(pool, { now, adapter })).rejects.toMatchObject({ code: 'not_found' })
    expect(await lapseRow(bad.subscription)).toMatchObject({ state: 'pending', reason: 'not_found' })
    expect(await lapseRow(good.subscription)).toMatchObject({ state: 'ordered' })
  })

  // Owner decision 2026-11-13: recording the refund of the customer's first payment drops the subscription to the free base.
  const operator = { issuer: 'vendor-test', actorUid: 7 }
  const invoiceOf = async (orderId: string) => (await pool.query('SELECT * FROM invoices WHERE order_id=$1', [orderId])).rows[0]
  /** The vendor's pending full refund of the invoice, recorded with a provider reference. */
  async function refundInvoice(invoiceId: string) {
    const note = randomUUID()
    await pool.query(`INSERT INTO invoice_adjustments(id,invoice_id,customer_id,kind,reason,amount_minor,currency,exponent,status,created_by,origin,cause)
      SELECT $1,id,customer_id,'credit_note','Customer asked within 14 days',total_minor,currency,exponent,'pending','vendor-test','vendor','vendor_refund' FROM invoices WHERE id=$2`, [note, invoiceId])
    return refundCreditNote(pool, { adjustment_id: note, actor: operator, request: { external_reference: `MOY-${randomUUID().slice(0, 8)}`, reason: 'Refunded in the provider dashboard' } })
  }
  // The lock is armed at the real time of the record, so it is processed no earlier than that.
  const refundAt = () => new Date(Math.max(later(30).getTime(), Date.now() + 60_000))
  async function settleRefundLock(f: Fixture, at = refundAt()) {
    await lower(f, at)
    const order = await lapseOrder(f.subscription)
    expect(await runJob(order.id, okRunner)).toMatchObject({ state: 'verified' })
    await processFreeBaseLocks(pool, { now: at, adapter, subscription_id: f.subscription })
    return order
  }
  /** A customer the vendor sold a paid subscription to, with no trial: paid and delivered. */
  async function paidCustomer(): Promise<Fixture & { order: string }> {
    const customer = randomUUID(), tenant = randomUUID()
    const slug = `t${tenant.replaceAll('-', '')}`
    await pool.query("INSERT INTO tenants(id,name,commercial_mode,hosting_model,inventory_target,operations_enabled,post_trial_supported,excess_supported) VALUES($1,'Paid','saas','shared_managed',$2,true,true,true)", [tenant, slug])
    await pool.query('INSERT INTO customers(id,name,tenant_id,admin_name,admin_login) VALUES($1,$2,$3,$4,$5)', [customer, 'Paid', tenant, 'Manager', `${customer}@example.test`])
    const bind = () => pool.query('INSERT INTO shared_registry_bindings(control_tenant_id,tenant_id,host,database_name,filestore,enabled,registry_revision) VALUES($1,$2,$3,$4,$4,true,1)', [tenant, slug, `${slug}.test`, `liwan_scratch_${slug.slice(1)}`])
    await bind()
    const principal = { actor_id: '7', kind: 'customer', customer_id: customer, tenant_id: tenant, capabilities: ['subscription.manage'] } as unknown as Principal
    const quote = await createQuoteForCustomer(pool, { customer_id: customer, request: request() }, beforeEnd)
    const input = { quote_id: quote.id, expected_subscription_revision: quote.expected_subscription_revision, idempotency_key: randomUUID() }
    const { order } = await transaction(pool, tx => acceptQuoteOn(tx, input, digestOf(input), quote, principal, beforeEnd))
    const attempt = await createPaymentAttempt(pool, { order_id: order.id, customer_id: customer, adapter, returnOrigin: origin })
    adapter.settle(attempt.provider_ref, 'succeeded')
    await handleProviderEvent(pool, { provider: 'simulator', rawBody: adapter.webhookBody(attempt.provider_ref), headers: {}, adapter })
    // Delivered, as the shared worker would leave it (the enrollment path is not under test here).
    await pool.query(`UPDATE subscriptions s SET applied_revision_id=target_revision_id,target_revision_id=NULL,state='active',
      renewal_at=(r.snapshot->>'period_end')::date,revision=s.revision+1 FROM subscription_revisions r WHERE r.id=s.target_revision_id AND s.customer_id=$1`, [customer])
    await pool.query("UPDATE orders SET fulfillment_state='applied' WHERE id=$1", [order.id])
    await pool.query("UPDATE commercial_outbox SET status='done' WHERE kind='fulfillment.enqueue' AND aggregate_id=$1", [order.id])
    const sub = await getSubscription(pool, customer)
    return { customer, tenant, subscription: sub.id, bind, principal, order: order.id }
  }

  it('drops a paid customer who never trialled to the free base and leaves the trial outcome empty', async () => {
    const f = await paidCustomer()
    const before = await row(f.subscription)
    expect(before).toMatchObject({ state: 'active', trial_outcome: null })
    await refundInvoice((await invoiceOf(f.order)).id)
    expect(await lapseRow(f.subscription)).toMatchObject({ state: 'pending', cause: 'refund', trial_ended_at: null })
    expect(await getSubscription(pool, f.customer)).toMatchObject({ pending_free_base_lock: 'refund' })
    await expect(createQuoteForCustomer(pool, { customer_id: f.customer, request: { ...request(), kind: 'change', subscription_id: f.subscription } }, refundAt()))
      .rejects.toMatchObject({ code: 'lock_pending' })
    await settleRefundLock(f)
    const after = await row(f.subscription)
    expect(after).toMatchObject({ state: 'active', trial_outcome: null })
    expect(after.renewal_at).toEqual(before.renewal_at)
    expect(await lapseRow(f.subscription)).toMatchObject({ state: 'done', cause: 'refund' })
    expect((await getSubscription(pool, f.customer)).applied?.bundle_revision_ids).toEqual([])
    const notice = (await pool.query("SELECT payload FROM commercial_outbox WHERE kind='free_base.locked' AND aggregate_id=$1", [f.subscription])).rows
    expect(notice).toEqual([{ payload: { cause: 'refund', outcome: 'free_base', kept: { bundle_revision_ids: [], paid_users: 0, paid_storage_gb: 0, paid_extra_branches: 0 } } }])
  })

  it('drops a converted trial whose conversion payment is refunded, and records the free-base outcome', async () => {
    const f = await endedTrial()
    const conversionAt = new Date('2026-11-15T09:00:00Z')
    const converted = await convertTrial(pool, { customer_id: f.customer, now: conversionAt, returnOrigin: origin })
    const hosted = await openCheckoutPayment(f, converted.order!.id, conversionAt)
    adapter.settle(hosted.provider_ref!, 'succeeded')
    await handleProviderEvent(pool, { provider: 'simulator', rawBody: adapter.webhookBody(hosted.provider_ref!), headers: {}, adapter, now: conversionAt })
    expect(await runJob(converted.order!.id, okRunner)).toMatchObject({ state: 'verified' })
    // The worker has delivered the deadline lift queued at payment.
    await pool.query("UPDATE shared_jobs SET state='verified' WHERE control_tenant_id=$1 AND payload->>'origin'='trial-end' AND state='queued'", [f.tenant])
    expect(await row(f.subscription)).toMatchObject({ state: 'active', trial_outcome: 'converted' })
    await refundInvoice((await invoiceOf(converted.order!.id)).id)
    await settleRefundLock(f)
    expect(await row(f.subscription)).toMatchObject({ state: 'active', trial_outcome: 'free_base' })
    expect((await getSubscription(pool, f.customer)).applied?.bundle_revision_ids).toEqual([])
  })

  it('re-arms a lapsed trial that bought after its lock, and keeps what a later unrefunded payment bought', async () => {
    const f = await endedTrial()
    await lapse(f)
    await lock(f)
    expect(await lapseRow(f.subscription)).toMatchObject({ state: 'done', cause: 'trial_end', order_seq: 1 })
    const users = await change(f, { requested_users: 5, bundle_revision_ids: [] }, later(5))
    expect(await runJob(users.order.id, okRunner)).toMatchObject({ state: 'verified' })
    const app = await change(f, { requested_users: 5, bundle_revision_ids: [bundle.id] }, later(10))
    expect(await runJob(app.order.id, okRunner)).toMatchObject({ state: 'verified' })
    const paidConfiguration = (await row(f.subscription)).applied_revision_id
    const renewalAt = (await row(f.subscription)).renewal_at
    await refundInvoice((await invoiceOf(users.order.id)).id)
    // The configuration the lock replaces is the one applied now, not the old trial revision.
    expect(await lapseRow(f.subscription)).toMatchObject({ state: 'pending', cause: 'refund', pre_lock_revision_id: paidConfiguration })
    const at = refundAt()
    await settleRefundLock(f, at)
    expect(await lapseRow(f.subscription)).toMatchObject({ state: 'done', cause: 'refund', order_seq: 2, pre_lock_revision_id: paidConfiguration })
    const applied = (await getSubscription(pool, f.customer)).applied!
    expect(applied.bundle_revision_ids).toEqual([bundle.id])
    expect(applied.entitlement.features['users.limit']).toBe(3)
    const settled = await row(f.subscription)
    expect(settled).toMatchObject({ trial_outcome: 'kept_subset' })
    // The kept app is priced, so the lock bills from the current period as a trial end does. The app is paid through
    // that period, so its renewal owes nothing; the next one charges the kept app alone.
    const day = async () => (await pool.query('SELECT renewal_at::text AS day FROM subscriptions WHERE id=$1', [f.subscription])).rows[0].day as string
    const period = (await pool.query("SELECT period_start::text AS start,(period_start + interval '1 month')::date::text AS next FROM free_base_locks WHERE subscription_id=$1", [f.subscription])).rows[0]
    expect(await day()).toBe(period.start)
    expect(renewalAt).not.toBeNull()
    const [paidThrough] = await generateRenewals(pool, { now: at, subscription_id: f.subscription, returnOrigin: origin })
    expect(paidThrough?.due_now.minor).toBe(0)
    for (let pass = 0; pass < 20 && await day() !== period.next; pass++) await processFulfillmentOutbox(pool, { limit: 100 })
    expect(await day()).toBe(period.next)
    const [next] = await generateRenewals(pool, { now: new Date(`${period.next}T09:00:00+03:00`), subscription_id: f.subscription, returnOrigin: origin })
    expect(next?.due_now.minor).toBe(Math.round(19900 * 1.15))
    const charged = (await pool.query("SELECT key FROM invoice_lines WHERE invoice_id=(SELECT id FROM invoices WHERE order_id=$1) AND kind<>'tax' AND amount_minor>0", [next!.id])).rows
    expect(charged.map(line => line.key)).toEqual([expect.stringContaining(bundle.id)])
  })

  it('reopens a trial after a refund lock from the configuration the refund replaced', async () => {
    const f = await endedTrial()
    await lapse(f)
    await lock(f)
    const bought = await change(f, { requested_users: 5, bundle_revision_ids: [bundle.id] }, later(5))
    expect(await runJob(bought.order.id, okRunner)).toMatchObject({ state: 'verified' })
    const paidConfiguration = (await row(f.subscription)).applied_revision_id
    await refundInvoice((await invoiceOf(bought.order.id)).id)
    const at = refundAt()
    await settleRefundLock(f, at)
    expect(await getSubscription(pool, f.customer)).toMatchObject({ trial_outcome: 'free_base', trial_reopenable: true })
    await extendTrial(pool, { subscription_id: f.subscription, days: 5, reason: 'Vendor reopened trial', actor: vendor.actor_id, now: at })
    const reopened = (await pool.query('SELECT r.snapshot FROM subscriptions s JOIN subscription_revisions r ON r.id=s.target_revision_id WHERE s.id=$1', [f.subscription])).rows[0].snapshot
    const source = (await pool.query('SELECT snapshot FROM subscription_revisions WHERE id=$1', [paidConfiguration])).rows[0].snapshot
    expect(reopened.bundle_revision_ids).toEqual(source.bundle_revision_ids)
    expect(reopened.entitlement.features['users.limit']).toBe(5)
    expect(await lapseRow(f.subscription)).toMatchObject({ state: 'superseded' })
  })

  it('shows a refund lock the tenant cannot take yet in the vendor attention list', async () => {
    const f = await paidCustomer()
    await refundInvoice((await invoiceOf(f.order)).id)
    await pool.query('UPDATE tenants SET post_trial_supported=false WHERE id=$1', [f.tenant])
    await processFreeBaseLocks(pool, { now: refundAt(), adapter, subscription_id: f.subscription })
    expect(await lapseRow(f.subscription)).toMatchObject({ state: 'pending', reason: 'tenant_upgrade_required' })
    const { items } = await attention(pool, true)
    expect(items.find(item => item.customer_id === f.customer)).toMatchObject({ kind: 'free_base_blocked', detail: 'tenant_upgrade_required' })
  })
  describe('what the customer is told and shown around the trial end', () => {
    const during = new Date(now.getTime() - 2 * 86_400_000)
    const mailbox = () => { const sent: any[] = []; return { sent, mail: { send: async (m: any) => { sent.push(m); return { accepted: true, provider_message_id: 'p' } } } as any } }

    it('shows the price after the trial in the preview, and null when the chosen configuration is free', async () => {
      const paid = await endedTrial({}, true, during)
      const preview = await trialEndPreview(pool, paid.customer, now)
      expect(preview.status).toBe('trialing')
      expect(preview.first_invoice).toBeNull()
      expect(preview.price_after_trial).toEqual({ currency: 'SAR', exponent: 2, minor: Math.round(19900 * 1.15) })
      const free = await endedTrial({ bundle_revision_ids: [] }, true, during)
      expect((await trialEndPreview(pool, free.customer, now)).price_after_trial).toBeNull()
    })

    it('shows the price the trial checkout charges per period, with every paid quantity', async () => {
      const f = await endedTrial({ requested_users: 5, requested_storage_mb: 40960, requested_extra_branches: 2 }, true, during)
      const preview = await trialEndPreview(pool, f.customer, now)
      expect(preview.price_after_trial!.minor).toBeGreaterThan(Math.round(19900 * 1.15))
      const converted = await convertTrial(pool, { customer_id: f.customer, now, returnOrigin: origin })
      const checkout = (await pool.query('SELECT payload FROM commercial_quotes WHERE id=(SELECT quote_id FROM orders WHERE id=$1)', [converted.order!.id])).rows[0].payload
      expect(preview.price_after_trial).toEqual(checkout.next_renewal)
    })

    it('says the first invoice is lower once part of the configuration was bought during the trial', async () => {
      const f = await endedTrial({ bundle_revision_ids: [] }, true, new Date(now.getTime() - 11 * 86_400_000))
      const bought = await change(f, { bundle_revision_ids: [bundle.id] }, new Date(now.getTime() - 10 * 86_400_000))
      expect(bought.quote.due_now.minor).toBeGreaterThan(0)
      expect(await runJob(bought.order.id, okRunner)).toMatchObject({ state: 'verified' })
      const { sent, mail } = mailbox()
      await sendTrialNotices(pool, { now, mail, returnOrigin: origin })
      const text: string = sent.find(m => m.to === `${f.customer}@example.test`).text
      expect(text).toContain('ستكون الفاتورة الأولى أقل، لأن جزءًا من الفترة مدفوع بالفعل.')
      expect(text).toContain('Your first invoice will be lower because part of the period is already paid.')
    })

    it('reports on_free_base from the applied pricing: false while trialing paid apps, true after the lapse, false once an app is bought again', async () => {
      const f = await endedTrial({}, true, during)
      expect(await getSubscription(pool, f.customer)).toMatchObject({ state: 'trialing', on_free_base: false })
      const free = await endedTrial({ bundle_revision_ids: [] }, true, during)
      expect((await getSubscription(pool, free.customer)).on_free_base).toBe(true)
      const lapsed = await endedTrial()
      await lapse(lapsed)
      await lock(lapsed)
      expect(await getSubscription(pool, lapsed.customer)).toMatchObject({ state: 'active', trial_outcome: 'free_base', on_free_base: true })
      const bought = await change(lapsed, { bundle_revision_ids: [bundle.id] }, later(5))
      expect(await runJob(bought.order.id, okRunner)).toMatchObject({ state: 'verified' })
      expect(await getSubscription(pool, lapsed.customer)).toMatchObject({ trial_outcome: 'free_base', on_free_base: false })
      const never = await paidCustomer()
      expect((await getSubscription(pool, never.customer)).on_free_base).toBe(false)
    })

    it('lets a lapsed customer buy an app back: preview, quote, accept, pay, deliver, with the right invoice (item 6)', async () => {
      const f = await endedTrial()
      await lapse(f)
      await lock(f)
      expect((await getSubscription(pool, f.customer)).applied?.bundle_revision_ids).toEqual([])
      // The usage collector keeps a sample younger than 15 minutes; `change` records one the way it would.
      const bought = await change(f, { bundle_revision_ids: [bundle.id] }, later(5))
      expect(bought.quote.due_now.minor).toBeGreaterThan(0)
      expect(await runJob(bought.order.id, okRunner)).toMatchObject({ state: 'verified' })
      const view = await getSubscription(pool, f.customer)
      expect(view).toMatchObject({ state: 'active', on_free_base: false })
      expect(view.applied?.bundle_revision_ids).toEqual([bundle.id])
      const invoice = await invoiceOf(bought.order.id)
      expect(invoice).toMatchObject({ status: 'paid', kind: 'change', total_minor: String(bought.quote.due_now.minor), currency: 'SAR' })
      // The invoice covers the rest of the current period: from the day of the purchase to the period's end.
      const covered = (await pool.query('SELECT period_start::text AS start,period_end::text AS end FROM invoices WHERE id=$1', [invoice.id])).rows[0]
      expect(covered).toEqual({ start: riyadhDate(later(5)), end: view.applied!.period_end })
    })

    it('sends the trial reminder with the price after the trial, correct number forms and readable units', async () => {
      const f = await endedTrial({}, true, new Date(now.getTime() - 11 * 86_400_000))
      const { sent, mail } = mailbox()
      await sendTrialNotices(pool, { now, mail, returnOrigin: origin })
      const text: string = sent.find(m => m.to === `${f.customer}@example.test`).text
      expect(text).toContain('لتستمر على تطبيقاتك بعد التجربة: 228.85 ر.س. شهريًا')
      expect(text).toContain('«راجع الاشتراك»')
      expect(text).toContain('with the button "Review subscription"')
      expect(text).not.toContain('ستكون الفاتورة الأولى أقل')
      expect(text).toContain('To keep your apps after the trial: 228.85 SAR monthly')
      expect(text).toContain('3 مستخدمين، 20 جيجابايت للتخزين، فرع إضافي واحد')
      expect(text).not.toMatch(/ميبيبايت|MiB|أول فاتورة|First invoice/)
      expect(text).toMatch(/\((باقي|المتبقي) (3 أيام|يومان|يوم واحد)\)/)
      expect(text).toMatch(/\((3|2|1) days? left\)/)
      const free = await endedTrial({ bundle_revision_ids: [] }, true, new Date(now.getTime() - 11 * 86_400_000))
      const freeMail = mailbox()
      await sendTrialNotices(pool, { now, mail: freeMail.mail, returnOrigin: origin })
      const freeText: string = freeMail.sent.find(m => m.to === `${free.customer}@example.test`).text
      expect(freeText).toContain('تستمر خطتك مجانًا بعد التجربة.')
      expect(freeText).toContain('Your plan continues free after the trial.')
    })

    it('tells a customer whose trial lapsed that the free base keeps their data and that they can subscribe at any time', async () => {
      const f = await endedTrial()
      await lapse(f)
      await lock(f)
      await pool.query("UPDATE commercial_outbox SET status='done' WHERE kind='free_base.locked' AND aggregate_id<>$1", [f.subscription])
      const [queued] = (await pool.query("SELECT payload FROM commercial_outbox WHERE kind='free_base.locked' AND aggregate_id=$1", [f.subscription])).rows
      expect(queued.payload).toMatchObject({ cause: 'trial_end', outcome: 'free_base' })
      const { sent, mail } = mailbox()
      await sendOverLimitNotices(pool, { mail, returnOrigin: origin })
      const text: string = sent.find(m => m.to === `${f.customer}@example.test`).text
      expect(text).toContain('عادت مساحة عملك إلى القاعدة المجانية')
      expect(text).toContain('بياناتك محفوظة')
      expect(text).toContain('يمكنك الاشتراك في أي وقت من صفحة الاشتراك')
    })
  })
})
