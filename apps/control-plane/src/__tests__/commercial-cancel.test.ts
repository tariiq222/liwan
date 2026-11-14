import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { Pool } from 'pg'
import type { Principal } from '@liwan/commercial-contracts'
import { client, money, monthly, setup, url } from './commercial-helpers.js'
import { startTrial } from '../commercial/trial.js'
import { armRefundLock, processFreeBaseLocks } from '../commercial/free-base-lock.js'
import { confirmBankTransfer } from '../commercial/bank-transfer.js'
import { listInvoices } from '../commercial/invoices.js'
import { settledTrialReopenSource } from '../commercial/trial-reopen.js'
import { trialEndPreview } from '../commercial/trial-preview.js'
import { applyDunning } from '../commercial/renewals.js'
import { runSubscriptionReconfigure } from '../shared/subscription-reconfigure.js'
import { generateRenewals } from '../commercial/renewals.js'
import { createQuoteForCustomer } from '../commercial/quotes.js'
import { acceptQuoteOn } from '../commercial/orders.js'
import { processFulfillmentOutbox } from '../commercial/fulfillment.js'
import { recordUsage } from '../commercial/usage.js'
import { suspendSubscription } from '../commercial/suspension.js'
import { getSubscription } from '../commercial/subscriptions.js'
import { SimulatorAdapter } from '../commercial/payment-simulator.js'
import { fixedReturnOrigin } from '../commercial/return-origin.js'
import { transaction } from '../db.js'
import { digestOf } from '../commercial/lifecycle.js'
import { createPaymentAttempt, handleProviderEvent } from '../commercial/payments.js'
import { queueScheduledBillingNotices } from '../commercial/billing-notices.js'
import { cancelAtPeriodEnd, resumeCancelled } from '../commercial/cancellation.js'
import { cancellationNotice, sendCancellationNotices } from '../commercial/cancellation-notices.js'
import { overLimitNotice } from '../commercial/over-limit-notices.js'
import type { MailAdapter } from '../commercial/mail-adapter.js'

const POLICY = '6f1c3d8e-0000-4000-8000-000000000001'
const suite = url ? describe : describe.skip

suite('a tenant cancels its paid subscription at the period end (owner decision 2026-11-13)', () => {
  const pool = new Pool({ connectionString: url, max: 6 })
  const api = client(pool)
  const reason = 'Cancellation acceptance'
  const placed = new Date('2026-11-12T09:00:00Z')
  const asked = new Date('2026-11-20T09:00:00Z')
  const adapter = new SimulatorAdapter()
  const origin = fixedReturnOrigin('https://liwan.test')
  let plan: any, bundle: any

  beforeAll(async () => {
    const { version } = await setup(pool)
    const release = (await api('POST', '/catalog/releases', { catalog_version: version, reason })).body
    const app = release.applications.find((a: any) => a.features.some((f: any) => f.key === 'projects.max_projects'))
    const b = await api('POST', '/bundles', { name: `Cancel bundle ${randomUUID()}`, description: 'Test', audience: { kind: 'public' },
      catalog_release_id: release.id, selections: [{ app_id: app.id, feature_keys: ['pmo.enabled'] }], domain_limits: { 'projects.max_projects': 10 },
      prices: [{ cadence: monthly, amount: money(19900) }] })
    const bv = await api('POST', `/bundles/${b.body.id}/validate`, { edit_revision: 1, reason })
    bundle = (await api('POST', `/bundles/${b.body.id}/publish`, { edit_revision: bv.body.edit_revision, reason })).body
    const p = await api('POST', '/plans', { name: `Cancel ${randomUUID()}`, audience: { kind: 'public' }, term_months: 12, currency: 'SAR',
      prices: [{ cadence: monthly, amount: money(0) }], platform_limits: {}, included_bundle_revision_ids: [], optional_bundle_revision_ids: [bundle.id],
      included_extra_branches: 1, extra_branch_prices: [{ cadence: monthly, amount: money(0) }], extra_branches_limit: null,
      included_users: 3, included_storage_mb: 20480, storage_step_mb: 10240, storage_step_threshold_mb: 102400, storage_large_step_mb: 102400,
      user_prices: [{ cadence: monthly, amount: money(2900) }], storage_prices: [{ cadence: monthly, amount: money(100) }],
      policy_revision_id: POLICY, trial_days: 14, grace_days: 7, auto_suspend: true, auto_renew_allowed: true })
    expect(p.status, JSON.stringify(p.body)).toBe(201)
    const pv = await api('POST', `/plans/${p.body.id}/validate`, { edit_revision: 1, reason })
    plan = (await api('POST', `/plans/${p.body.id}/publish`, { edit_revision: pv.body.edit_revision, reason })).body
  })
  afterAll(async () => { await pool.end() })

  const request = () => ({ kind: 'new' as const, plan_revision_id: plan.id, bundle_revision_ids: [bundle.id], cadence: monthly,
    requested_extra_branches: 0, requested_users: 3, requested_storage_mb: 20480 })
  const row = async (id: string) => (await pool.query('SELECT * FROM subscriptions WHERE id=$1', [id])).rows[0]
  const lockRow = async (id: string) => (await pool.query('SELECT *,period_start::text AS start FROM free_base_locks WHERE subscription_id=$1', [id])).rows[0]
  const audits = async (id: string, action: string) => (await pool.query('SELECT actor,reason,metadata FROM audit_events WHERE subject=$1 AND action=$2 ORDER BY created_at', [id, action])).rows
  const outbox = async (id: string, kind: string) => (await pool.query('SELECT payload,status FROM commercial_outbox WHERE aggregate_id=$1 AND kind=$2 ORDER BY created_at', [id, kind])).rows

  async function tenantFor(name: string) {
    const customer = randomUUID(), tenant = randomUUID()
    const slug = `t${tenant.replaceAll('-', '')}`
    await pool.query("INSERT INTO tenants(id,name,commercial_mode,hosting_model,inventory_target,operations_enabled,post_trial_supported,excess_supported) VALUES($1,$2,'saas','shared_managed',$3,true,true,true)", [tenant, name, slug])
    await pool.query('INSERT INTO customers(id,name,tenant_id,admin_name,admin_login) VALUES($1,$2,$3,$4,$5)', [customer, name, tenant, 'Manager', `${customer}@example.test`])
    await pool.query('INSERT INTO shared_registry_bindings(control_tenant_id,tenant_id,host,database_name,filestore,enabled,registry_revision) VALUES($1,$2,$3,$4,$4,true,1)', [tenant, slug, `${slug}.test`, `liwan_scratch_${slug.slice(1)}`])
    const principal = { actor_id: '7', kind: 'customer', customer_id: customer, tenant_id: tenant, capabilities: ['subscription.manage'] } as unknown as Principal
    return { customer, tenant, principal }
  }
  /** A customer who bought the paid configuration outright: paid and delivered, renewing on `renewal_at`. */
  async function paidCustomer() {
    const f = await tenantFor('Paid')
    const quote = await createQuoteForCustomer(pool, { customer_id: f.customer, request: request() }, placed)
    const input = { quote_id: quote.id, expected_subscription_revision: quote.expected_subscription_revision, idempotency_key: randomUUID() }
    const { order } = await transaction(pool, tx => acceptQuoteOn(tx, input, digestOf(input), quote, f.principal, placed))
    const attempt = await createPaymentAttempt(pool, { order_id: order.id, customer_id: f.customer, adapter, returnOrigin: origin })
    adapter.settle(attempt.provider_ref, 'succeeded')
    await handleProviderEvent(pool, { provider: 'simulator', rawBody: adapter.webhookBody(attempt.provider_ref), headers: {}, adapter })
    await pool.query(`UPDATE subscriptions s SET applied_revision_id=target_revision_id,target_revision_id=NULL,state='active',
      renewal_at=(r.snapshot->>'period_end')::date,revision=s.revision+1 FROM subscription_revisions r WHERE r.id=s.target_revision_id AND s.customer_id=$1`, [f.customer])
    await pool.query("UPDATE orders SET fulfillment_state='applied' WHERE id=$1", [order.id])
    await pool.query("UPDATE commercial_outbox SET status='done' WHERE kind='fulfillment.enqueue' AND aggregate_id=$1", [order.id])
    const sub = (await pool.query('SELECT id,renewal_at::text AS renewal_on FROM subscriptions WHERE customer_id=$1', [f.customer])).rows[0]
    return { ...f, subscription: sub.id as string, order: order.id as string, renewalOn: sub.renewal_on as string }
  }
  type Fixture = Awaited<ReturnType<typeof paidCustomer>>
  const at = (renewalOn: string, hours = 9) => new Date(`${renewalOn}T0${hours}:00:00Z`)
  const vendor = (f: Fixture) => ({ subscription_id: f.subscription, by: 'vendor' as const, actor: 'vendor:7', reason: 'Asked by phone' })
  const customerAsks = (f: Fixture, now = asked) => ({ customer_id: f.customer, by: 'customer' as const, actor: '7', reason: null, now })

  async function freshUsage(f: { tenant: string; subscription: string }, when: Date) {
    const numeric = Object.entries((await pool.query('SELECT snapshot FROM subscription_revisions WHERE id=(SELECT applied_revision_id FROM subscriptions WHERE id=$1)', [f.subscription])).rows[0].snapshot.entitlement.features)
      .filter(([, value]) => typeof value === 'number').map(([key]) => key)
    await recordUsage(pool, { tenant_id: f.tenant, observed_at: when, source: 'cancel',
      metrics: Object.fromEntries(numeric.map(key => [key, 0])),
      limit_gates: Object.fromEntries(numeric.map(key => [key, key === 'projects.max_projects' ? ['pmo.enabled'] : []])) })
  }
  const okRunner = async ({ job }: { job: any }) => ({ order_id: job.authority.order_id, tenant_id: job.binding.database, database: job.binding.database,
    target_revision_id: job.authority.target_revision_id, observed_entitlement_digest: job.authority.entitlement.digest, observed_at: placed.toISOString(), branch_bindings: [], modules_installed: [] })
  async function runJob(orderId: string) {
    for (let pass = 0; pass < 20; pass++) {
      await processFulfillmentOutbox(pool, { limit: 100 })
      if ((await pool.query('SELECT 1 FROM fulfillment_effects WHERE order_id=$1 AND job_id IS NOT NULL', [orderId])).rowCount) break
    }
    const jobId = (await pool.query('SELECT job_id FROM fulfillment_effects WHERE order_id=$1', [orderId])).rows[0].job_id
    return runSubscriptionReconfigure(pool, jobId, okRunner)
  }
  const lockOrder = async (subscription: string) => (await pool.query("SELECT * FROM orders WHERE subscription_id=$1 AND idempotency_key LIKE $2 ORDER BY created_at DESC,id LIMIT 1", [subscription, `free-base-lock:${subscription}:%`])).rows[0]
  /** The scheduler's free-base pass at `when`, the lock order delivered, and the pass that settles it. */
  async function dropAt(f: Fixture, when: Date) {
    await freshUsage(f, when)
    await processFreeBaseLocks(pool, { now: when, adapter, subscription_id: f.subscription })
    const order = await lockOrder(f.subscription)
    expect(await runJob(order.id)).toMatchObject({ state: 'verified' })
    await processFreeBaseLocks(pool, { now: when, adapter, subscription_id: f.subscription })
    return order
  }

  it('cancels and resumes idempotently, revisioned and audited with who asked', async () => {
    const f = await paidCustomer()
    const before = await row(f.subscription)
    const view = await cancelAtPeriodEnd(pool, customerAsks(f))
    expect(view.cancellation).toEqual({ requested_at: asked.toISOString(), requested_by: 'customer', effective_on: f.renewalOn })
    const cancelled = await row(f.subscription)
    expect(cancelled.revision).toBe(before.revision + 1)
    expect(cancelled).toMatchObject({ state: 'active', cancel_requested_by: 'customer' })
    expect(cancelled.renewal_at).toEqual(before.renewal_at)
    // Asking twice changes nothing: no revision, no second audit row, no second notice.
    await cancelAtPeriodEnd(pool, customerAsks(f, new Date(asked.getTime() + 3_600_000)))
    expect((await row(f.subscription)).revision).toBe(cancelled.revision)
    expect(await audits(f.subscription, 'subscription.cancel_requested')).toEqual([{ actor: '7', reason: '', metadata: { by: 'customer', effective_on: f.renewalOn } }])
    expect(await outbox(f.subscription, 'cancellation.notice')).toHaveLength(1)

    const resumed = await resumeCancelled(pool, customerAsks(f, new Date(asked.getTime() + 7_200_000)))
    expect(resumed.cancellation).toBeNull()
    const after = await row(f.subscription)
    expect(after).toMatchObject({ cancel_requested_at: null, cancel_requested_by: null, cancel_reason: null })
    expect(after.revision).toBe(cancelled.revision + 1)
    await resumeCancelled(pool, customerAsks(f))
    expect((await row(f.subscription)).revision).toBe(after.revision)
    expect(await audits(f.subscription, 'subscription.cancel_withdrawn')).toHaveLength(1)
  })

  it('generates no renewal and queues no upcoming notice while cancelled, and renews normally once resumed', async () => {
    const f = await paidCustomer()
    const eve = at(f.renewalOn, 6)
    eve.setUTCDate(eve.getUTCDate() - 2)
    await queueScheduledBillingNotices(pool, eve)
    const notices = async () => (await outbox(f.subscription, 'billing.notice')).filter(r => r.payload.type === 'renewal_upcoming')
    expect(await notices()).toHaveLength(1)
    await cancelAtPeriodEnd(pool, customerAsks(f))
    // The upcoming notice queued before the cancellation is closed, and the scan queues none for the same renewal.
    expect((await notices()).map(r => r.status)).toEqual(['done'])
    const nextDay = new Date(eve.getTime() + 86_400_000)
    await queueScheduledBillingNotices(pool, nextDay)
    expect(await notices()).toHaveLength(1)

    await generateRenewals(pool, { now: at(f.renewalOn), returnOrigin: origin, subscription_id: f.subscription })
    expect((await pool.query('SELECT 1 FROM renewals WHERE subscription_id=$1', [f.subscription])).rowCount).toBe(0)

    await resumeCancelled(pool, customerAsks(f))
    const renewals = await generateRenewals(pool, { now: at(f.renewalOn), returnOrigin: origin, subscription_id: f.subscription })
    expect(renewals).toHaveLength(1)
    expect((await pool.query('SELECT 1 FROM renewals WHERE subscription_id=$1', [f.subscription])).rowCount).toBe(1)
  })

  it('arms the cancelled lock at the period end, drops to the free base, keeps the trial outcome and clears the request', async () => {
    const f = await paidCustomer()
    await cancelAtPeriodEnd(pool, customerAsks(f))
    // Before the renewal date nothing happens.
    await processFreeBaseLocks(pool, { now: new Date(at(f.renewalOn).getTime() - 86_400_000), adapter, subscription_id: f.subscription })
    expect(await lockRow(f.subscription)).toBeUndefined()
    const before = await row(f.subscription)
    const when = at(f.renewalOn)
    await freshUsage(f, when)
    await processFreeBaseLocks(pool, { now: when, adapter, subscription_id: f.subscription })
    expect(await lockRow(f.subscription)).toMatchObject({ cause: 'cancelled', state: 'ordered', trial_ended_at: null })
    expect((await lockRow(f.subscription)).start).toBe(f.renewalOn)
    expect(await getSubscription(pool, f.customer)).toMatchObject({ pending_free_base_lock: 'cancelled' })
    await expect(resumeCancelled(pool, customerAsks(f))).rejects.toMatchObject({ code: 'cancel_already_effective' })
    await expect(createQuoteForCustomer(pool, { customer_id: f.customer, request: { ...request(), kind: 'change', subscription_id: f.subscription } }, when))
      .rejects.toMatchObject({ code: 'lock_pending' })

    const order = await lockOrder(f.subscription)
    expect(await runJob(order.id)).toMatchObject({ state: 'verified' })
    await processFreeBaseLocks(pool, { now: when, adapter, subscription_id: f.subscription })
    const after = await row(f.subscription)
    expect(after).toMatchObject({ state: 'active', trial_outcome: null, cancel_requested_at: null, cancel_requested_by: null })
    expect((await pool.query("SELECT renewal_at::text = (period_start + interval '1 month')::date::text AS next FROM subscriptions s JOIN free_base_locks l ON l.subscription_id=s.id WHERE s.id=$1", [f.subscription])).rows[0].next).toBe(true)
    expect(after.revision).toBeGreaterThan(before.revision)
    expect(await lockRow(f.subscription)).toMatchObject({ state: 'done', cause: 'cancelled' })
    const view = await getSubscription(pool, f.customer)
    expect(view.applied?.bundle_revision_ids).toEqual([])
    expect(view.cancellation).toBeNull()
    expect((await audits(f.subscription, 'subscription.cancellation_effective')).length).toBe(1)
    expect((await outbox(f.subscription, 'free_base.locked')).map(r => r.payload)).toEqual([
      { cause: 'cancelled', outcome: 'free_base', kept: { bundle_revision_ids: [], paid_users: 0, paid_storage_gb: 0, paid_extra_branches: 0 } }])
    // Nothing is billed for the free base afterwards, and the cancelled customer can buy again.
    expect((await pool.query('SELECT 1 FROM invoices WHERE subscription_id=$1 AND status=\'issued\'', [f.subscription])).rowCount).toBe(0)
  })

  it('voids the unpaid renewal invoice of the period the customer is leaving', async () => {
    const f = await paidCustomer()
    const when = at(f.renewalOn)
    await generateRenewals(pool, { now: when, returnOrigin: origin, subscription_id: f.subscription })
    expect((await pool.query("SELECT 1 FROM invoices WHERE subscription_id=$1 AND status='issued'", [f.subscription])).rowCount).toBe(1)
    await cancelAtPeriodEnd(pool, customerAsks(f, when))
    await freshUsage(f, when)
    await processFreeBaseLocks(pool, { now: when, adapter, subscription_id: f.subscription })
    expect((await pool.query("SELECT 1 FROM invoices WHERE subscription_id=$1 AND status='issued'", [f.subscription])).rowCount).toBe(0)
    expect((await pool.query("SELECT 1 FROM invoices WHERE subscription_id=$1 AND status='void'", [f.subscription])).rowCount).toBe(1)
    expect(await lockRow(f.subscription)).toMatchObject({ cause: 'cancelled' })
  })

  it('lets the customer buy again after the drop through the normal change flow', async () => {
    const f = await paidCustomer()
    await cancelAtPeriodEnd(pool, customerAsks(f))
    const when = at(f.renewalOn)
    await dropAt(f, when)
    expect((await row(f.subscription)).cancel_requested_at).toBeNull()
    const later = new Date(when.getTime() + 86_400_000)
    await freshUsage(f, later)
    const quote = await createQuoteForCustomer(pool, { customer_id: f.customer,
      request: { ...request(), kind: 'change', subscription_id: f.subscription } }, later)
    const input = { quote_id: quote.id, expected_subscription_revision: quote.expected_subscription_revision, idempotency_key: randomUUID() }
    const { order } = await transaction(pool, tx => acceptQuoteOn(tx, input, digestOf(input), quote, f.principal, later))
    expect(order.fulfillment_state).not.toBe('applied')
    expect(await getSubscription(pool, f.customer)).toMatchObject({ cancellation: null, pending_free_base_lock: null })
  })

  it('keeps an item paid through a later date until that date, then drops it', async () => {
    const f = await paidCustomer()
    // A paid change whose invoice line runs past the renewal date.
    const mid = new Date(placed.getTime() + 86_400_000)
    await freshUsage(f, mid)
    const quote = await createQuoteForCustomer(pool, { customer_id: f.customer,
      request: { ...request(), kind: 'change', subscription_id: f.subscription, requested_users: 5 } }, mid)
    const input = { quote_id: quote.id, expected_subscription_revision: quote.expected_subscription_revision, idempotency_key: randomUUID() }
    const { order } = await transaction(pool, tx => acceptQuoteOn(tx, input, digestOf(input), quote, f.principal, mid))
    await pool.query('UPDATE orders SET created_at=$2 WHERE id=$1', [order.id, mid])
    const attempt = await createPaymentAttempt(pool, { order_id: order.id, customer_id: f.customer, adapter, returnOrigin: origin })
    adapter.settle(attempt.provider_ref, 'succeeded')
    await handleProviderEvent(pool, { provider: 'simulator', rawBody: adapter.webhookBody(attempt.provider_ref), headers: {}, adapter })
    expect(await runJob(order.id)).toMatchObject({ state: 'verified' })
    const through = '2026-12-20'
    await pool.query('ALTER TABLE invoice_lines DISABLE TRIGGER USER')
    try { await pool.query("UPDATE invoice_lines SET period_end=$2 WHERE invoice_id IN (SELECT id FROM invoices WHERE order_id=$1) AND key LIKE '%:delta'", [order.id, through]) }
    finally { await pool.query('ALTER TABLE invoice_lines ENABLE TRIGGER USER') }
    await cancelAtPeriodEnd(pool, customerAsks(f))
    await dropAt(f, at(f.renewalOn))
    const partial = await row(f.subscription)
    expect(partial).toMatchObject({ trial_outcome: null })
    expect(partial.cancel_requested_at).not.toBeNull()
    expect((await pool.query('SELECT renewal_at::text AS on FROM subscriptions WHERE id=$1', [f.subscription])).rows[0].on).toBe(through)
    expect((await outbox(f.subscription, 'free_base.locked')).map(r => r.payload.outcome)).toEqual(['kept_subset'])
    // The renewal is not generated for the still-paid items; at their date the drop runs again and nothing is left.
    await generateRenewals(pool, { now: at(through), returnOrigin: origin, subscription_id: f.subscription })
    expect((await pool.query("SELECT 1 FROM renewals WHERE subscription_id=$1 AND period_start=$2", [f.subscription, through])).rowCount).toBe(0)
    await dropAt(f, at(through))
    const done = await row(f.subscription)
    expect(done.cancel_requested_at).toBeNull()
    expect(await lockRow(f.subscription)).toMatchObject({ state: 'done', cause: 'cancelled' })
    expect((await outbox(f.subscription, 'free_base.locked')).map(r => r.payload.outcome)).toEqual(['kept_subset', 'free_base'])
  })

  it('refuses a trial, a pending lock, a manual suspension, an overdue subscription, a free base and a change in flight', async () => {
    const trial = await tenantFor('Trial')
    await startTrial(pool, { customer_id: trial.customer, request: request(), principal: trial.principal, now: placed })
    await pool.query('UPDATE subscriptions SET applied_revision_id=target_revision_id,target_revision_id=NULL,revision=revision+1 WHERE customer_id=$1', [trial.customer])
    await pool.query("UPDATE orders SET fulfillment_state='applied' WHERE customer_id=$1", [trial.customer])
    await expect(cancelAtPeriodEnd(pool, { customer_id: trial.customer, by: 'customer', actor: '7', reason: null, now: asked })).rejects.toMatchObject({ code: 'cancel_trial_unsupported', status: 409 })

    const locked = await paidCustomer()
    await pool.query("INSERT INTO free_base_locks(subscription_id,pre_lock_revision_id,period_start,cause) SELECT id,applied_revision_id,renewal_at,'refund' FROM subscriptions WHERE id=$1", [locked.subscription])
    await expect(cancelAtPeriodEnd(pool, customerAsks(locked))).rejects.toMatchObject({ code: 'lock_pending' })

    const suspended = await paidCustomer()
    await suspendSubscription(pool, { subscription_id: suspended.subscription, reason: 'Abuse', actor: 'vendor:7' })
    await expect(cancelAtPeriodEnd(pool, customerAsks(suspended))).rejects.toMatchObject({ code: 'subscription_suspended' })

    const overdue = await paidCustomer()
    await pool.query("UPDATE subscriptions SET state='past_due',revision=revision+1 WHERE id=$1", [overdue.subscription])
    await expect(cancelAtPeriodEnd(pool, customerAsks(overdue))).rejects.toMatchObject({ code: 'subscription_past_due' })

    const free = await paidCustomer()
    await cancelAtPeriodEnd(pool, customerAsks(free))
    await dropAt(free, at(free.renewalOn))
    await expect(cancelAtPeriodEnd(pool, customerAsks(free))).rejects.toMatchObject({ code: 'nothing_to_cancel' })

    const pending = await paidCustomer()
    await freshUsage(pending, asked)
    const quote = await createQuoteForCustomer(pool, { customer_id: pending.customer,
      request: { ...request(), kind: 'change', subscription_id: pending.subscription, requested_users: 5 } }, asked)
    const input = { quote_id: quote.id, expected_subscription_revision: quote.expected_subscription_revision, idempotency_key: randomUUID() }
    await transaction(pool, tx => acceptQuoteOn(tx, input, digestOf(input), quote, pending.principal, asked))
    await expect(cancelAtPeriodEnd(pool, customerAsks(pending))).rejects.toMatchObject({ code: 'subscription_change_pending' })
  })

  it('refuses a paid change while cancelled and accepts it again after resuming', async () => {
    const f = await paidCustomer()
    await cancelAtPeriodEnd(pool, customerAsks(f))
    await freshUsage(f, asked)
    const quote = await createQuoteForCustomer(pool, { customer_id: f.customer,
      request: { ...request(), kind: 'change', subscription_id: f.subscription, requested_users: 5 } }, asked)
    const input = { quote_id: quote.id, expected_subscription_revision: quote.expected_subscription_revision, idempotency_key: randomUUID() }
    await expect(transaction(pool, tx => acceptQuoteOn(tx, input, digestOf(input), quote, f.principal, asked))).rejects.toMatchObject({ code: 'subscription_cancelling', status: 409 })
    await resumeCancelled(pool, customerAsks(f))
    const fresh = await createQuoteForCustomer(pool, { customer_id: f.customer,
      request: { ...request(), kind: 'change', subscription_id: f.subscription, requested_users: 5 } }, asked)
    const again = { quote_id: fresh.id, expected_subscription_revision: fresh.expected_subscription_revision, idempotency_key: randomUUID() }
    await expect(transaction(pool, tx => acceptQuoteOn(tx, again, digestOf(again), fresh, f.principal, asked))).resolves.toBeTruthy()
  })

  it('lets the vendor cancel and resume on the customer behalf, audited as the vendor', async () => {
    const f = await paidCustomer()
    const view = await cancelAtPeriodEnd(pool, { ...vendor(f), now: asked })
    expect(view.cancellation).toMatchObject({ requested_by: 'vendor', effective_on: f.renewalOn })
    expect(await audits(f.subscription, 'subscription.cancel_requested')).toEqual([{ actor: 'vendor:7', reason: 'Asked by phone', metadata: { by: 'vendor', effective_on: f.renewalOn } }])
    expect((await row(f.subscription)).cancel_reason).toBe('Asked by phone')
    await resumeCancelled(pool, { ...vendor(f), now: asked })
    expect(await audits(f.subscription, 'subscription.cancel_withdrawn')).toMatchObject([{ actor: 'vendor:7' }])
    expect((await row(f.subscription)).cancel_reason).toBeNull()
  })

  it('sends the confirmation, the reminder three days before the end and the resume confirmation once each', async () => {
    const f = await paidCustomer()
    const send = vi.fn(async () => ({ accepted: true, provider_message_id: 'm' }))
    const mail = { send } as unknown as MailAdapter
    const mine = () => (send.mock.calls as unknown as [{ to: string; subject: string; text: string }][]).map(call => call[0]).filter(message => message.to === `${f.customer}@example.test`)
    await cancelAtPeriodEnd(pool, customerAsks(f))
    await sendCancellationNotices(pool, { now: asked, mail, returnOrigin: origin })
    await sendCancellationNotices(pool, { now: asked, mail })
    expect(mine()).toHaveLength(1)
    expect(mine()[0]!.text).toContain('Your workspace: https://')
    expect(mine()[0]!.text).toContain(f.renewalOn)
    expect(mine()[0]!.subject).toBe(cancellationNotice({ type: 'cancelled', subscription_id: f.subscription, effective_on: f.renewalOn }, 0).subject)

    const threeDays = new Date(at(f.renewalOn).getTime() - 3 * 86_400_000)
    await sendCancellationNotices(pool, { now: threeDays, mail })
    await sendCancellationNotices(pool, { now: new Date(threeDays.getTime() + 86_400_000), mail })
    expect(mine()).toHaveLength(2)
    expect(mine()[1]!.text).toContain('3 days')

    await resumeCancelled(pool, customerAsks(f))
    await sendCancellationNotices(pool, { now: threeDays, mail })
    await sendCancellationNotices(pool, { now: threeDays, mail })
    expect(mine()).toHaveLength(3)
    expect(mine()[2]!.subject).toBe('استأنفنا اشتراكك في LiwanOS')
    // No reminder for a cancellation that was withdrawn.
    await sendCancellationNotices(pool, { now: new Date(at(f.renewalOn).getTime() - 86_400_000), mail })
    expect(mine()).toHaveLength(3)
  })

  it('tells the tenant the paid period ended when the lock settles, in Arabic then English', () => {
    const notice = overLimitNotice({ cause: 'cancelled' })
    expect(notice.subject).toBe('انتهى اشتراكك المدفوع في LiwanOS')
    expect(notice.text.split('\n')[1]).toMatch(/^Your paid subscription ended/)
  })

  // The verifier's scenarios, round 2.
  const renewalOf = async (subscription: string) => (await pool.query(`SELECT o.*,i.id AS invoice_id,i.total_minor AS invoice_total FROM renewals r JOIN orders o ON o.id=r.order_id
    JOIN invoices i ON i.id=r.invoice_id WHERE r.subscription_id=$1 AND r.status<>'superseded' ORDER BY r.created_at DESC LIMIT 1`, [subscription])).rows[0]
  const due = async (f: Fixture) => {
    const when = at(f.renewalOn)
    await generateRenewals(pool, { now: when, returnOrigin: origin, subscription_id: f.subscription })
    return when
  }
  async function payRenewal(f: Fixture) {
    const order = await renewalOf(f.subscription)
    // A customer pays through the card form; the vendor's hosted link is the one flow these tests can settle by reference.
    await createPaymentAttempt(pool, { order_id: order.id, customer_id: f.customer, adapter, returnOrigin: origin })
    const attempt = (await pool.query("SELECT * FROM payment_attempts WHERE order_id=$1 AND status IN ('created','redirected','pending') ORDER BY created_at DESC LIMIT 1", [order.id])).rows[0]
    adapter.settle(attempt.provider_ref, 'succeeded')
    await handleProviderEvent(pool, { provider: 'simulator', rawBody: adapter.webhookBody(attempt.provider_ref), headers: {}, adapter })
    return { order, attempt }
  }
  /** What the shared worker leaves once a renewal is delivered: the period moved on a month. */
  async function applyRenewal(f: Fixture, orderId: string) {
    await pool.query("UPDATE orders SET fulfillment_state='applied' WHERE id=$1", [orderId])
    await pool.query("UPDATE subscriptions SET renewal_at=renewal_at + interval '1 month',revision=revision+1 WHERE id=$1", [f.subscription])
  }

  it('A: a card payment in flight at cancel is voided when the drop arms, and a late capture is refunded rather than kept', async () => {
    const f = await paidCustomer()
    const when = await due(f)
    const order = await renewalOf(f.subscription)
    await createPaymentAttempt(pool, { order_id: order.id, customer_id: f.customer, adapter, returnOrigin: origin })
    const attempt = (await pool.query('SELECT * FROM payment_attempts WHERE order_id=$1', [order.id])).rows[0]
    await cancelAtPeriodEnd(pool, customerAsks(f, when))
    await freshUsage(f, when)
    await processFreeBaseLocks(pool, { now: when, adapter, subscription_id: f.subscription })
    expect(await lockRow(f.subscription)).toMatchObject({ cause: 'cancelled' })
    expect((await pool.query('SELECT cancelled,automatic_refund FROM orders WHERE id=$1', [order.id])).rows[0]).toEqual({ cancelled: true, automatic_refund: true })
    adapter.settle(attempt.provider_ref, 'succeeded')
    await handleProviderEvent(pool, { provider: 'simulator', rawBody: adapter.webhookBody(attempt.provider_ref), headers: {}, adapter })
    expect((await pool.query('SELECT payment_state FROM orders WHERE id=$1', [order.id])).rows[0].payment_state).toMatch(/refund/)
  })

  it('B: a renewal that is paid but not yet applied cannot be cancelled, and cancelling first then paying never drops a paid tenant', async () => {
    const paid = await paidCustomer()
    await due(paid)
    const { order } = await payRenewal(paid)
    expect((await pool.query('SELECT payment_state,fulfillment_state FROM orders WHERE id=$1', [order.id])).rows[0]).toMatchObject({ payment_state: 'paid' })
    await expect(cancelAtPeriodEnd(pool, customerAsks(paid))).rejects.toMatchObject({ code: 'renewal_in_progress', status: 409 })
    expect(await getSubscription(pool, paid.customer)).toMatchObject({ cancellable: false })

    // The mirror: the cancel was accepted while the invoice was open, then the invoice was paid before the drop armed.
    const f = await paidCustomer()
    const when = await due(f)
    await cancelAtPeriodEnd(pool, customerAsks(f, when))
    const second = await payRenewal(f)
    await freshUsage(f, when)
    await processFreeBaseLocks(pool, { now: when, adapter, subscription_id: f.subscription })
    expect(await lockRow(f.subscription)).toBeUndefined()
    expect((await row(f.subscription)).cancel_requested_at).not.toBeNull()
    // Once the renewal applies the period moved on, and the cancellation means the end of the period just paid.
    await applyRenewal(f, second.order.id)
    await processFreeBaseLocks(pool, { now: when, adapter, subscription_id: f.subscription })
    expect(await lockRow(f.subscription)).toBeUndefined()
    const next = (await pool.query('SELECT renewal_at::text AS on FROM subscriptions WHERE id=$1', [f.subscription])).rows[0].on as string
    expect((await getSubscription(pool, f.customer)).cancellation?.effective_on).toBe(next)
    await freshUsage(f, at(next))
    await processFreeBaseLocks(pool, { now: at(next), adapter, subscription_id: f.subscription })
    expect(await lockRow(f.subscription)).toMatchObject({ cause: 'cancelled' })
  })

  it('B2: a bank transfer confirmed after the cancel pays the period and the drop waits; after the drop armed it is refused, never paid and dropped', async () => {
    // The value date is a Riyadh calendar day (UTC+3): the UTC date is yesterday there between 00:00 and 03:00.
    const today = new Date(Date.now() + 3 * 3_600_000).toISOString().slice(0, 10)
    const before = await paidCustomer()
    const when = await due(before)
    await cancelAtPeriodEnd(pool, customerAsks(before, when))
    const invoice = await renewalOf(before.subscription)
    await confirmBankTransfer(pool, { invoice_id: invoice.invoice_id, operator: 'vendor:7', reference: `TRF-${randomUUID()}`, amount: Number(invoice.invoice_total), value_date: today })
    expect((await pool.query('SELECT payment_state FROM orders WHERE id=$1', [invoice.id])).rows[0].payment_state).toBe('paid')
    await freshUsage(before, when)
    await processFreeBaseLocks(pool, { now: when, adapter, subscription_id: before.subscription })
    expect(await lockRow(before.subscription)).toBeUndefined()

    const after = await paidCustomer()
    const day = await due(after)
    await cancelAtPeriodEnd(pool, customerAsks(after, day))
    await freshUsage(after, day)
    await processFreeBaseLocks(pool, { now: day, adapter, subscription_id: after.subscription })
    expect(await lockRow(after.subscription)).toMatchObject({ cause: 'cancelled' })
    const voided = (await pool.query(`SELECT o.*,i.id AS invoice_id,i.total_minor AS invoice_total FROM renewals r JOIN orders o ON o.id=r.order_id JOIN invoices i ON i.id=r.invoice_id WHERE r.subscription_id=$1`, [after.subscription])).rows[0]
    await expect(confirmBankTransfer(pool, { invoice_id: voided.invoice_id, operator: 'vendor:7', reference: `TRF-${randomUUID()}`, amount: Number(voided.invoice_total), value_date: today }))
      .rejects.toMatchObject({ status: 409 })
    expect((await pool.query('SELECT payment_state FROM orders WHERE id=$1', [voided.id])).rows[0].payment_state).not.toBe('paid')
  })

  it('C: the scheduler down for two days still drops from the renewal date, and C2: a late resume before the arm renews normally', async () => {
    const f = await paidCustomer()
    await cancelAtPeriodEnd(pool, customerAsks(f))
    const late = new Date(at(f.renewalOn).getTime() + 2 * 86_400_000)
    await dropAt(f, late)
    expect((await lockRow(f.subscription)).start).toBe(f.renewalOn)
    expect((await row(f.subscription)).cancel_requested_at).toBeNull()
    expect((await pool.query("SELECT renewal_at::text = (period_start + interval '1 month')::date::text AS ok FROM subscriptions s JOIN free_base_locks l ON l.subscription_id=s.id WHERE s.id=$1", [f.subscription])).rows[0].ok).toBe(true)

    const g = await paidCustomer()
    await cancelAtPeriodEnd(pool, customerAsks(g))
    const afterDate = new Date(at(g.renewalOn).getTime() + 86_400_000)
    await resumeCancelled(pool, customerAsks(g, afterDate))
    const renewals = await generateRenewals(pool, { now: afterDate, returnOrigin: origin, subscription_id: g.subscription })
    expect(renewals).toHaveLength(1)
    await processFreeBaseLocks(pool, { now: afterDate, adapter, subscription_id: g.subscription })
    expect(await lockRow(g.subscription)).toBeUndefined()
  })

  it('D: a cancelled drop is never offered as a trial reopen, while a trial-era lock still is', async () => {
    const f = await paidCustomer()
    await pool.query("UPDATE subscriptions SET trial_outcome='free_base',revision=revision+1 WHERE id=$1", [f.subscription])
    await cancelAtPeriodEnd(pool, customerAsks(f))
    await dropAt(f, at(f.renewalOn))
    const sub = await row(f.subscription)
    expect(sub.trial_outcome).toBe('free_base')
    expect((await getSubscription(pool, f.customer)).trial_reopenable).toBe(false)
    expect(await settledTrialReopenSource(pool, sub)).toBeNull()
    // The trial-end preview describes a trial's end; a cancellation drop has none, even for a customer who once trialled.
    await expect(trialEndPreview(pool, f.customer)).rejects.toMatchObject({ code: 'trial_not_active', status: 404 })
    await pool.query("UPDATE free_base_locks SET cause='trial_end',trial_ended_at=now() WHERE subscription_id=$1", [f.subscription])
    expect(await settledTrialReopenSource(pool, sub)).not.toBeNull()
  })

  it('E: a refund lock survives a cancellation, which then still drops at the renewal date', async () => {
    const f = await paidCustomer()
    await cancelAtPeriodEnd(pool, customerAsks(f))
    const refundAt = new Date(asked.getTime() + 86_400_000)
    await transaction(pool, client => armRefundLock(client, { subscription_id: f.subscription, now: refundAt }))
    await expect(cancelAtPeriodEnd(pool, customerAsks(f))).resolves.toBeTruthy()
    await dropAt(f, refundAt)
    expect(await lockRow(f.subscription)).toMatchObject({ state: 'done', cause: 'refund' })
    expect((await row(f.subscription)).cancel_requested_at).not.toBeNull()
    expect(await audits(f.subscription, 'subscription.cancellation_effective')).toHaveLength(0)
    expect((await pool.query('SELECT 1 FROM renewals WHERE subscription_id=$1', [f.subscription])).rowCount).toBe(0)
    await freshUsage(f, at(f.renewalOn))
    await processFreeBaseLocks(pool, { now: at(f.renewalOn), adapter, subscription_id: f.subscription })
    expect(await lockRow(f.subscription)).toMatchObject({ cause: 'cancelled' })
  })

  it('E2: a cancel is refused while a refund lock is pending', async () => {
    const f = await paidCustomer()
    await transaction(pool, client => armRefundLock(client, { subscription_id: f.subscription, now: asked }))
    await expect(cancelAtPeriodEnd(pool, customerAsks(f))).rejects.toMatchObject({ code: 'lock_pending' })
  })

  it('F: the subscription and invoice views show the database dates in any server timezone', async () => {
    const f = await paidCustomer()
    const view = await getSubscription(pool, f.customer)
    expect(view.renewal_at).toBe(f.renewalOn)
    await cancelAtPeriodEnd(pool, customerAsks(f))
    const cancelled = await getSubscription(pool, f.customer)
    expect(cancelled.cancellation?.effective_on).toBe(cancelled.renewal_at)
    await due(f)
    const invoices = await listInvoices(pool, { customer_id: f.customer })
    const period = (await pool.query('SELECT period_start::text AS a,period_end::text AS b FROM invoices WHERE id=$1', [invoices.items[0]!.id])).rows[0]
    expect([invoices.items[0]!.period_start, invoices.items[0]!.period_end]).toEqual([period.a, period.b])
  })

  it('keeps what an earlier lock excluded from revenue history when the row is rewritten for a cancellation', async () => {
    const f = await paidCustomer()
    const old = new Date('2026-08-10T00:00:00Z')
    await pool.query(`INSERT INTO free_base_locks(subscription_id,pre_lock_revision_id,period_start,armed_at,trial_ended_at,cause,state)
      SELECT id,applied_revision_id,'2026-08-10',$2,$2,'trial_end','done' FROM subscriptions WHERE id=$1`, [f.subscription, old])
    await cancelAtPeriodEnd(pool, customerAsks(f))
    await freshUsage(f, at(f.renewalOn))
    await processFreeBaseLocks(pool, { now: at(f.renewalOn), adapter, subscription_id: f.subscription })
    expect((await lockRow(f.subscription)).excluded_until).toEqual(old)
  })

  it('a lock postponed for days leaves the cancelled tenant unbilled: no renewal, no dunning, no billing notice', async () => {
    const f = await paidCustomer()
    await cancelAtPeriodEnd(pool, customerAsks(f))
    await pool.query('UPDATE tenants SET post_trial_supported=false WHERE id=$1', [f.tenant])
    const when = at(f.renewalOn)
    for (const days of [0, 3, 10]) {
      const now = new Date(when.getTime() + days * 86_400_000)
      await freshUsage(f, now)
      await processFreeBaseLocks(pool, { now, adapter, subscription_id: f.subscription })
      await generateRenewals(pool, { now, returnOrigin: origin, subscription_id: f.subscription })
      await applyDunning(pool, { now })
      await queueScheduledBillingNotices(pool, now)
    }
    expect(await lockRow(f.subscription)).toMatchObject({ state: 'pending', reason: 'tenant_upgrade_required' })
    expect((await pool.query('SELECT 1 FROM renewals WHERE subscription_id=$1', [f.subscription])).rowCount).toBe(0)
    expect((await pool.query('SELECT 1 FROM invoices WHERE subscription_id=$1 AND status=\'issued\'', [f.subscription])).rowCount).toBe(0)
    expect((await row(f.subscription)).state).toBe('active')
  })

  it('applies migration 56: the cancellation columns and the cancelled lock cause', async () => {
    expect((await pool.query('SELECT 1 FROM schema_migrations WHERE version=56')).rowCount).toBe(1)
    const f = await paidCustomer()
    await expect(pool.query("UPDATE subscriptions SET cancel_requested_at=now(),revision=revision+1 WHERE id=$1", [f.subscription])).rejects.toMatchObject({ constraint: 'subscriptions_cancel_request_check' })
    await expect(pool.query("UPDATE subscriptions SET cancel_requested_at=now(),cancel_requested_by='tenant',revision=revision+1 WHERE id=$1", [f.subscription])).rejects.toBeTruthy()
    await expect(pool.query("INSERT INTO free_base_locks(subscription_id,pre_lock_revision_id,period_start,cause) SELECT id,applied_revision_id,renewal_at,'bogus' FROM subscriptions WHERE id=$1", [f.subscription])).rejects.toMatchObject({ constraint: 'free_base_locks_cause_check' })
    await pool.query("INSERT INTO free_base_locks(subscription_id,pre_lock_revision_id,period_start,cause) SELECT id,applied_revision_id,renewal_at,'cancelled' FROM subscriptions WHERE id=$1", [f.subscription])
    await expect(pool.query("INSERT INTO free_base_locks(subscription_id,pre_lock_revision_id,period_start,cause) SELECT id,applied_revision_id,renewal_at,'trial_end' FROM subscriptions WHERE id=$1 ON CONFLICT(subscription_id) DO UPDATE SET cause='trial_end'", [f.subscription]))
      .rejects.toMatchObject({ constraint: 'free_base_locks_trial_ended_check' })
  })
})
