import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { Pool } from 'pg'
import type { Principal } from '@liwan/commercial-contracts'
import { client, money, monthly, setup, url } from './commercial-helpers.js'
import { convertTrial, startTrial } from '../commercial/trial.js'
import { endTrialOn, expireTrials } from '../commercial/trial-expiry.js'
import { processTrialLapses } from '../commercial/trial-lapse.js'
import { attention } from '../commercial/attention.js'
import { runSubscriptionReconfigure } from '../shared/subscription-reconfigure.js'
import { applyDunning, generateRenewals } from '../commercial/renewals.js'
import { applyReceipt, processFulfillmentOutbox } from '../commercial/fulfillment.js'
import { createQuoteForCustomer } from '../commercial/quotes.js'
import { acceptQuoteOn } from '../commercial/orders.js'
import { collectUsage } from '../commercial/usage-collector.js'
import { recordUsage } from '../commercial/usage.js'
import { resumeSubscription, suspendSubscription, syncTenantStatus } from '../commercial/suspension.js'
import { getSubscription } from '../commercial/subscriptions.js'
import { SimulatorAdapter } from '../commercial/payment-simulator.js'
import { sendTrialNotices } from '../commercial/trial-notices.js'
import { fixedReturnOrigin } from '../commercial/return-origin.js'
import { pushCommercialExpiry } from '../commercial/expiry-push.js'
import { transaction } from '../db.js'
import { digestOf } from '../commercial/lifecycle.js'
import { createPaymentAttempt, handleProviderEvent } from '../commercial/payments.js'
import { recoverPaidFulfillment } from '../commercial/paid-fulfillment-recovery.js'
import { processRefundOutbox } from '../commercial/settlements.js'
import { recoverCommercialSystemJobs } from '../shared/commercial-recovery.js'
import { trialEndPreview } from '../commercial/trial-preview.js'

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
  async function endedTrial(over: Record<string, unknown> = {}, bound = true, start = new Date(now.getTime() - 15 * 86_400_000)) {
    const customer = randomUUID(), tenant = randomUUID()
    const slug = `t${tenant.replaceAll('-', '')}`
    await pool.query("INSERT INTO tenants(id,name,commercial_mode,hosting_model,inventory_target,operations_enabled,post_trial_supported,excess_supported) VALUES($1,'Free base','saas','shared_managed',$2,true,true,true)", [tenant, slug])
    await pool.query('INSERT INTO customers(id,name,tenant_id,admin_name,admin_login) VALUES($1,$2,$3,$4,$5)', [customer, 'Free base', tenant, 'Manager', `${customer}@example.test`])
    const bind = () => pool.query('INSERT INTO shared_registry_bindings(control_tenant_id,tenant_id,host,database_name,filestore,enabled,registry_revision) VALUES($1,$2,$3,$4,$4,true,1)', [tenant, slug, `${slug}.test`, `liwan_scratch_${slug.slice(1)}`])
    if (bound) await bind()
    const principal = { actor_id: '7', kind: 'customer', customer_id: customer, tenant_id: tenant, capabilities: ['subscription.manage'] } as unknown as Principal
    await startTrial(pool, { customer_id: customer, request: { ...request(), ...over }, principal, now: start })
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
    target_revision_id: job.authority.target_revision_id, observed_entitlement_digest: job.authority.entitlement.digest, observed_at: beforeEnd.toISOString(), branch_bindings: [], modules_installed: [] })
  /** Enqueues the order's job and runs it with `runner`, as the shared worker would. */
  async function runJob(orderId: string, runner: any) {
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
    await processTrialLapses(pool, { now: at, adapter, subscription_id: f.subscription })
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

  it('locks once under concurrent scans, applies exact limits and never queues a separate expiry clear', async () => {
    const f = await endedTrial({ requested_users: 8, requested_storage_mb: 40960 })
    await Promise.all([lapse(f), lapse(f)])
    expect(await lapseRow(f.subscription)).toMatchObject({ state: 'pending' })
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
    await processTrialLapses(pool, { now, subscription_id: f.subscription })
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
    const [first] = await generateRenewals(pool, { now, subscription_id: f.subscription, adapter, returnOrigin: origin })
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
    const converted = await convertTrial(pool, { customer_id: f.customer, now: conversionAt, adapter, returnOrigin: origin })
    expect(converted.order?.due_now.minor).toBe(Math.round((19900 + Math.round(5800 * 26 / 30)) * 1.15))
    const job = (await pool.query("SELECT id,payload FROM shared_jobs WHERE control_tenant_id=$1 AND payload->>'origin'='trial-end'", [f.tenant])).rows[0]
    expect(job.payload.authority).toMatchObject({ trial_ends_at: conversionAt.toISOString(), post_trial_features: { 'pmo.enabled': false, 'users.limit': 5 } })
    expect((await getSubscription(pool, f.customer)).state).toBe('past_due')
    const prior = (await getSubscription(pool, f.customer)).applied!.id
    expect(converted.order!.target_revision_id).not.toBe(prior)
    expect(converted.order!.expected_applied_revision_id).toBe(prior)
    await runSubscriptionReconfigure(pool, job.id, async input => ({
      ...await okRunner(input), observed_at: conversionAt.toISOString(), observed_entitlement_digest: job.payload.authority.post_trial_digest,
    }))
    adapter.settle(converted.attempt!.provider_ref, 'succeeded')
    await handleProviderEvent(pool, { provider: 'simulator', rawBody: adapter.webhookBody(converted.attempt!.provider_ref), headers: {}, adapter })
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
    await processTrialLapses(pool, { now, subscription_id: f.subscription })
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
    await processTrialLapses(pool, { now, subscription_id: f.subscription })
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

  it('returns an unpaid kept subset to free base after first invoice grace (T9)', async () => {
    const f = await endedTrial()
    const paid = await change(f, { requested_users: 5 }, beforeEnd)
    expect(await runJob(paid.order.id, okRunner)).toMatchObject({ state: 'verified' })
    await lapse(f)
    await lock(f)
    const [first] = await generateRenewals(pool, { now, subscription_id: f.subscription, adapter, returnOrigin: origin })
    await pool.query("UPDATE payment_attempts SET status='failed' WHERE order_id=$1", [first!.id])
    const deadline = new Date(Math.max(now.getTime(), Date.now()) + 8 * 86_400_000)
    await applyDunning(pool, { now: deadline })
    expect(await lapseRow(f.subscription)).toMatchObject({ state: 'pending', force_empty: true })
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
    await collectUsage(pool, { limit: 100, runner: async input => input.tenant_id === f.tenant ? {
      database: binding.database_name, observed_at: new Date().toISOString(), usage,
      limit_gates: Object.fromEntries(Object.keys(usage).map(key => [key, []])),
      post_trial_supported: true, excess_supported: true, storage_bytes: 20480 * 1024 * 1024 + 17,
    } : null })
    expect(await lapse(f)).toMatchObject({ deferred: [f.subscription] })
    expect(await trialEndPreview(pool, f.customer)).toMatchObject({ excess: { storage_bytes: 17, source: 'usage_snapshot' } })
    const job = (await pool.query("SELECT id,payload FROM shared_jobs WHERE control_tenant_id=$1 AND payload->>'origin'='trial-end'", [f.tenant])).rows[0]
    expect(job.payload.authority.post_trial_features['pmo.enabled']).toBe(false)
    await runSubscriptionReconfigure(pool, job.id, async input => ({
      ...await okRunner(input), post_trial_supported: true, excess_supported: true,
    }))
    expect(await lapse(f)).toMatchObject({ lapsed: [f.subscription] })
  })

  it('rolls back expiry and its lapse together if the transaction crashes (T12)', async () => {
    const f = await endedTrial()
    const original = await row(f.subscription)
    await expect(transaction(pool, async client => {
      expect(await endTrialOn(client, f.subscription, { now, convert: false })).toBe('lapsed')
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
    await expect(processTrialLapses(pool, { now, adapter })).rejects.toMatchObject({ code: 'not_found' })
    expect(await lapseRow(bad.subscription)).toMatchObject({ state: 'pending', reason: 'not_found' })
    expect(await lapseRow(good.subscription)).toMatchObject({ state: 'ordered' })
  })
})
