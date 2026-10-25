import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { Pool } from 'pg'
import { daysBetween, riyadhDate, type Principal } from '@webvue/commercial-contracts'
import { client, money, monthly, setup, url } from './commercial-helpers.js'
import { convertTrial, extendTrial, startTrial } from '../commercial/trial.js'
import { routesB } from '../commercial/routes-b.js'
import { getSubscription } from '../commercial/subscriptions.js'
import { expireTrials } from '../commercial/trial-expiry.js'
import { commercialValidUntil } from '../commercial/fulfillment.js'
import { SimulatorAdapter } from '../commercial/payment-simulator.js'
import { sendTrialNotices } from '../commercial/trial-notices.js'

const suite = url ? describe : describe.skip
suite('commercial trial', () => {
  const pool = new Pool({ connectionString: url, max: 4 })
  const api = client(pool)
  const reason = 'Trial acceptance'
  let plan: any, principal: Principal, tenant: string, customer: string
  const now = new Date('2026-10-25T09:00:00Z')
  const request = () => ({ kind: 'new' as const, plan_revision_id: plan.id, bundle_revision_ids: [], cadence: monthly,
    requested_extra_branches: 0, requested_users: 3, requested_storage_mb: 5120 })
  async function newCustomer(bind = true) {
    customer = randomUUID()
    const ownTenant = randomUUID()
    await pool.query("INSERT INTO tenants(id,name,commercial_mode,hosting_model,inventory_target,operations_enabled) VALUES($1,'Trial customer','saas','managed',$2,true)", [ownTenant, `trial-${ownTenant}`])
    await pool.query('INSERT INTO customers(id,name,tenant_id,admin_login) VALUES($1,$2,$3,$4)', [customer, 'Trial customer', ownTenant, `${customer}@example.test`])
    if (bind) {
      const slug = `t${ownTenant.replaceAll('-', '')}`
      await pool.query('INSERT INTO shared_registry_bindings(control_tenant_id,tenant_id,host,database_name,filestore,enabled,registry_revision) VALUES($1,$2,$3,$4,$4,true,1)', [ownTenant, slug, `${slug}.trial.test`, `webvue_scratch_${slug.slice(1)}`])
    }
    return { id: customer, principal: { ...principal, customer_id: customer, tenant_id: ownTenant } as Principal }
  }
  beforeAll(async () => {
    const { version } = await setup(pool)
    await api('POST', '/catalog/releases', { catalog_version: version, reason })
    const created = await api('POST', '/plans', { name: `Trial ${randomUUID()}`, audience: { kind: 'public' }, term_months: 12, currency: 'SAR',
      prices: [{ cadence: monthly, amount: money(30000) }], platform_limits: {}, included_bundle_revision_ids: [], optional_bundle_revision_ids: [],
      included_extra_branches: 0, extra_branch_prices: [{ cadence: monthly, amount: money(0) }], extra_branches_limit: null,
      included_users: 3, included_storage_mb: 5120, user_prices: [{ cadence: monthly, amount: money(0) }], storage_prices: [{ cadence: monthly, amount: money(0) }],
      policy_revision_id: '6f1c3d8e-0000-4000-8000-000000000001', trial_days: 14, grace_days: 7, auto_suspend: true, auto_renew_allowed: true })
    const validated = await api('POST', `/plans/${created.body.id}/validate`, { edit_revision: 1, reason })
    plan = (await api('POST', `/plans/${created.body.id}/publish`, { edit_revision: validated.body.edit_revision, reason })).body
    tenant = randomUUID()
    await pool.query("INSERT INTO tenants(id,name,commercial_mode,hosting_model,inventory_target,operations_enabled) VALUES($1,'Trial','saas','managed',$2,true)", [tenant, `trial-${tenant}`])
    principal = { actor_id: '7', kind: 'customer', customer_id: '', tenant_id: tenant, capabilities: ['subscription.manage'] } as Principal
  })
  afterAll(async () => { await pool.end() })

  it('creates a zero-due order and sets trialing with trial_ends_at', async () => {
    const c = await newCustomer()
    const customerId = c.id
    const result = await startTrial(pool, { customer_id: c.id, request: request(), principal: c.principal, now })
    expect(result.order.due_now.minor).toBe(0)
    expect(result.order.payment_state).toBe('not_required')
    expect(result.order.fulfillment_state).toBe('queued')
    const sub = await getSubscription(pool, customerId)
    expect(sub.state).toBe('trialing')
    expect(daysBetween(riyadhDate(now), riyadhDate(new Date(sub.trial_ends_at!)))).toBe(14)
    expect((await pool.query('SELECT trial_used_at FROM customers WHERE id=$1', [customerId])).rows[0].trial_used_at).toBeTruthy()
    expect((await pool.query('SELECT count(*)::int AS n FROM invoices WHERE customer_id=$1', [customerId])).rows[0].n).toBe(0)
  })
  it('records the trial once per customer', async () => {
    const c = await newCustomer()
    await startTrial(pool, { customer_id: c.id, request: request(), principal: c.principal, now })
    await expect(startTrial(pool, { customer_id: c.id, request: request(), principal: c.principal, now }))
      .rejects.toMatchObject({ code: 'trial_already_used' })
  })
  async function onlyTrial(customerId: string) {
    await pool.query("UPDATE subscriptions SET state='past_due',revision=revision+1 WHERE state='trialing' AND customer_id<>$1", [customerId])
  }
  async function trialAt(at: Date, daysLeft: number) {
    const c = await newCustomer()
    const start = new Date(at.getTime() - (plan.trial_days - daysLeft) * 86_400_000)
    await startTrial(pool, { customer_id: c.id, request: request(), principal: c.principal, now: start })
    // Fulfillment is exercised by its own suite; here the trial is applied so expiry and renewals can see it.
    await pool.query('UPDATE subscriptions SET applied_revision_id=target_revision_id,target_revision_id=NULL,revision=revision+1 WHERE customer_id=$1', [c.id])
    await pool.query("UPDATE orders SET fulfillment_state='applied' WHERE subscription_id=(SELECT id FROM subscriptions WHERE customer_id=$1)", [c.id])
    return c
  }
  it('ends a trial by issuing the first renewal invoice', async () => {
    const c = await trialAt(now, -1)
    const adapter = new SimulatorAdapter()
    await expireTrials(pool, { now, adapter, allowedOrigin: 'https://webvue.test', return_path: '/subscription/status' })
    const after = await getSubscription(pool, c.id)
    expect(after.state).toBe('past_due')
    expect((await pool.query('SELECT count(*)::int AS n FROM invoices WHERE customer_id=$1', [c.id])).rows[0].n).toBe(1)
  })
  it('is idempotent across a repeated run', async () => {
    const c = await trialAt(now, -1)
    const adapter = new SimulatorAdapter()
    const args = { now, adapter, allowedOrigin: 'https://webvue.test', return_path: '/x' }
    await expireTrials(pool, args)
    await expireTrials(pool, args)
    expect((await pool.query('SELECT count(*)::int AS n FROM invoices WHERE customer_id=$1', [c.id])).rows[0].n).toBe(1)
  })
  it('does not end a trial before its end date', async () => {
    const c = await trialAt(now, 2)
    await expireTrials(pool, { now, adapter: new SimulatorAdapter(), allowedOrigin: 'https://webvue.test', return_path: '/x' })
    expect((await getSubscription(pool, c.id)).state).toBe('trialing')
  })
  it('writes each notice threshold exactly once', async () => {
    const c = await trialAt(now, 3)
    await onlyTrial(c.id)
    const sent: unknown[] = []
    const mail = { send: async (message: unknown) => { sent.push(message); return { accepted: true, provider_message_id: 'p1' } } }
    expect(await sendTrialNotices(pool, { now, mail })).toBe(1)
    expect(await sendTrialNotices(pool, { now, mail })).toBe(0)
    expect(sent).toHaveLength(1)
    const subscriptionId = (await getSubscription(pool, c.id)).id
    const notice = (await pool.query("SELECT payload FROM commercial_outbox WHERE kind='trial.notice' AND aggregate_id=$1", [subscriptionId])).rows[0]
    expect(notice.payload).toMatchObject({ subscription_id: subscriptionId, days_left: 3 })
  })
  async function vendorPost(path: string, body: Record<string, unknown>, runtime?: { adapter: SimulatorAdapter; allowedOrigin: string }) {
    return routesB(pool, { method: 'POST', pathname: `/v1/commercial${path}`, raw: JSON.stringify(body), issuer: 'trial-test', actor: 1,
      capabilities: ['vendor.subscriptions.manage'], stepUpFresh: true }, new URL(`http://localhost/v1/commercial${path}`), runtime)
  }
  it('extends a trial and audits it', async () => {
    const c = await trialAt(now, 5)
    const sub = await getSubscription(pool, c.id)
    const response = await vendorPost(`/trials/${sub.id}/extend`, { days: 7, reason: 'promised more time' })
    expect(response!.status).toBe(200)
    const after = await getSubscription(pool, c.id)
    expect(daysBetween(riyadhDate(now), riyadhDate(new Date(after.trial_ends_at!)))).toBe(12)
    expect((await pool.query("SELECT action FROM audit_events WHERE action='trial.extended' AND subject=$1", [sub.id])).rowCount).toBe(1)
    const job = (await pool.query("SELECT payload FROM shared_jobs WHERE payload->'authority'->>'target_revision_id'=$1 AND payload->'authority' ? 'commercial_valid_until'", [sub.applied!.id])).rows[0]
    expect(job?.payload.authority.commercial_valid_until).toBe('2026-11-13')
    expect(job?.payload.authority.commercial_valid_until_revision).toBe(1)
  })
  it('refuses an extension without a reason', async () => {
    const c = await trialAt(now, 5)
    const sub = await getSubscription(pool, c.id)
    await expect(vendorPost(`/trials/${sub.id}/extend`, { days: 7 })).rejects.toMatchObject({ status: 422 })
  })
  it('ends a trial from the console and issues the first invoice', async () => {
    const c = await trialAt(now, 5)
    const sub = await getSubscription(pool, c.id)
    const response = await vendorPost(`/trials/${sub.id}/end`, { reason: 'customer asked to start now' }, { adapter: new SimulatorAdapter(), allowedOrigin: 'https://webvue.test' })
    expect(response!.status).toBe(200)
    expect((await getSubscription(pool, c.id)).state).toBe('past_due')
    expect((await pool.query('SELECT count(*)::int AS n FROM invoices WHERE customer_id=$1', [c.id])).rows[0].n).toBe(1)
    expect((await pool.query("SELECT action FROM audit_events WHERE action='trial.ended' AND subject=$1", [sub.id])).rowCount).toBe(1)
    const job = (await pool.query("SELECT payload FROM shared_jobs WHERE payload->'authority'->>'target_revision_id'=$1 AND payload->'authority' ? 'commercial_valid_until' AND payload->'authority'->>'commercial_valid_until' IS NULL", [sub.applied!.id])).rows[0]
    expect(job).toBeTruthy()
    expect(job.payload.authority.commercial_valid_until_revision).toBe(1)
  })
  it('converts a trial on demand and issues the first invoice with a hosted attempt', async () => {
    // A different, lexicographically lower subscription is due in the same renewal pass. Its order
    // must never be returned to this customer.
    const other = await trialAt(now, -1)
    const otherSub = await getSubscription(pool, other.id)
    const thirdTenant = randomUUID(), third = randomUUID()
    await pool.query("INSERT INTO tenants(id,name,commercial_mode,hosting_model,inventory_target,operations_enabled) VALUES($1,'Another','saas','managed',$2,true)", [thirdTenant, `trial-${thirdTenant}`])
    await pool.query('INSERT INTO customers(id,name,tenant_id,admin_login) VALUES($1,$2,$3,$4)', [third, 'Another customer', thirdTenant, `${third}@example.test`])
    await pool.query(`INSERT INTO subscriptions(id,customer_id,tenant_id,state,renewal_at,applied_revision_id)
      VALUES('00000000-0000-4000-8000-000000000001',$1,$2,'past_due','2026-10-20',$3)`, [third, thirdTenant, otherSub.applied!.id])
    const c = await trialAt(now, 5)
    const result = await convertTrial(pool, { customer_id: c.id, now, adapter: new SimulatorAdapter(), allowedOrigin: 'https://webvue.test' })
    expect(result.order).toBeTruthy()
    expect(result.order!.customer_id).toBe(c.id)
    expect(result.attempt?.order_id).toBe(result.order!.id)
    expect(result.attempt?.redirect_url).toBeTruthy()
    expect((await getSubscription(pool, c.id)).state).toBe('past_due')
    expect((await pool.query('SELECT count(*)::int AS n FROM invoices WHERE customer_id=$1', [c.id])).rows[0].n).toBe(1)
    expect((await pool.query("SELECT count(*)::int AS n FROM audit_events WHERE action='trial.converted' AND subject=(SELECT id::text FROM subscriptions WHERE customer_id=$1)", [c.id])).rows[0].n).toBe(1)
  })
  it('catches up a notice when the scheduler missed the exact day', async () => {
    const c = await trialAt(now, 2)
    await onlyTrial(c.id)
    const sent: unknown[] = []
    const mail = { send: async (message: unknown) => { sent.push(message); return { accepted: true, provider_message_id: 'p2' } } }
    expect(await sendTrialNotices(pool, { now, mail })).toBe(1)
    expect(await sendTrialNotices(pool, { now, mail })).toBe(0)
    const subscriptionId = (await getSubscription(pool, c.id)).id
    const notice = (await pool.query("SELECT payload FROM commercial_outbox WHERE kind='trial.notice' AND aggregate_id=$1", [subscriptionId])).rows[0]
    expect(notice.payload).toMatchObject({ days_left: 2 })
  })
  it('retries a failed notice send on the next run', async () => {
    const c = await trialAt(now, 3)
    await onlyTrial(c.id)
    let attempts = 0
    const mail = { send: async () => { attempts++; if (attempts === 1) throw new Error('smtp_down'); return { accepted: true, provider_message_id: 'p3' } } }
    expect(await sendTrialNotices(pool, { now, mail })).toBe(1)
    expect((await pool.query("SELECT status FROM commercial_outbox WHERE kind='trial.notice' AND status='failed'")).rowCount).toBe(1)
    expect(await sendTrialNotices(pool, { now, mail })).toBe(1)
    expect(await sendTrialNotices(pool, { now, mail })).toBe(0)
    expect((await pool.query("SELECT status FROM commercial_outbox WHERE kind='trial.notice' AND status='failed'")).rowCount).toBe(0)
  })
  it('sends the trial end plus grace to Odoo and clears it for a paid order', async () => {
    const client = { query: async () => ({ rows: [{ grace_days: 7 }] }) } as never
    const trial = { kind: 'new', payment_state: 'not_required', trial_ends_at: '2026-11-01T09:00:00Z', snapshot: { plan_revision_id: 'p' } }
    expect(await commercialValidUntil(client, trial)).toBe('2026-11-08')
    expect(await commercialValidUntil(client, { ...trial, payment_state: 'paid' })).toBeNull()
  })
  it('refuses to push a trial date without a tenant binding', async () => {
    const c = await newCustomer(false)
    await startTrial(pool, { customer_id: c.id, request: request(), principal: c.principal, now })
    await pool.query('UPDATE subscriptions SET applied_revision_id=target_revision_id,target_revision_id=NULL,revision=revision+1 WHERE customer_id=$1', [c.id])
    await pool.query("UPDATE orders SET fulfillment_state='applied' WHERE subscription_id=(SELECT id FROM subscriptions WHERE customer_id=$1)", [c.id])
    const sub = (await pool.query('SELECT id FROM subscriptions WHERE customer_id=$1', [c.id])).rows[0]
    await expect(extendTrial(pool, { subscription_id: sub.id, days: 5, reason: 'more', actor: 'vendor' }))
      .rejects.toMatchObject({ code: 'tenant_binding_unavailable' })
  })
  it('leaves the date to a fulfilment that is still pending', async () => {
    const c = await newCustomer()
    await startTrial(pool, { customer_id: c.id, request: request(), principal: c.principal, now })
    const sub = (await pool.query('SELECT id FROM subscriptions WHERE customer_id=$1', [c.id])).rows[0]
    const extended = await extendTrial(pool, { subscription_id: sub.id, days: 3, reason: 'pending', actor: 'vendor' })
    expect(extended.trial_ends_at).toBeTruthy()
  })
  it('refuses a trial on a tenant known to lack the expiry field', async () => {
    const c = await newCustomer()
    const tenant = (await pool.query('SELECT tenant_id FROM customers WHERE id=$1', [c.id])).rows[0].tenant_id
    await pool.query('UPDATE tenants SET commercial_expiry_supported=false WHERE id=$1', [tenant])
    await expect(startTrial(pool, { customer_id: c.id, request: request(), principal: c.principal, now }))
      .rejects.toMatchObject({ code: 'tenant_upgrade_required' })
  })
  it('does not grant a trial for an application the customer did not choose', async () => {
    const c = await newCustomer()
    await startTrial(pool, { customer_id: c.id, request: request(), principal: c.principal, now })
    const sub = await getSubscription(pool, c.id)
    expect(sub.applied).toBeNull()
    const snapshot = (await pool.query('SELECT snapshot FROM subscription_revisions WHERE subscription_id=$1', [sub.id])).rows[0].snapshot
    expect(snapshot.entitlement.features['pmo.enabled']).toBe(false)
  })
})
