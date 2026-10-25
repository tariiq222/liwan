import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { Pool } from 'pg'
import { daysBetween, riyadhDate, type Principal } from '@webvue/commercial-contracts'
import { client, money, monthly, setup, url } from './commercial-helpers.js'
import { startTrial } from '../commercial/trial.js'
import { getSubscription } from '../commercial/subscriptions.js'

const suite = url ? describe : describe.skip
suite('commercial trial', () => {
  const pool = new Pool({ connectionString: url, max: 4 })
  const api = client(pool)
  const reason = 'Trial acceptance'
  let plan: any, principal: Principal, tenant: string, customer: string
  const now = new Date('2026-10-25T09:00:00Z')
  const request = () => ({ kind: 'new' as const, plan_revision_id: plan.id, bundle_revision_ids: [], cadence: monthly,
    requested_extra_branches: 0, requested_users: 3, requested_storage_mb: 5120 })
  async function newCustomer() {
    customer = randomUUID()
    const ownTenant = randomUUID()
    await pool.query("INSERT INTO tenants(id,name,commercial_mode,hosting_model,inventory_target,operations_enabled) VALUES($1,'Trial customer','saas','managed',$2,true)", [ownTenant, `trial-${ownTenant}`])
    await pool.query('INSERT INTO customers(id,name,tenant_id) VALUES($1,$2,$3)', [customer, 'Trial customer', ownTenant])
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
  it('grants only the applications the customer chose', async () => {
    const c = await newCustomer()
    await startTrial(pool, { customer_id: c.id, request: request(), principal: c.principal, now })
    const sub = await getSubscription(pool, c.id)
    expect(sub.applied).toBeNull()
    const snapshot = (await pool.query('SELECT snapshot FROM subscription_revisions WHERE subscription_id=$1', [sub.id])).rows[0].snapshot
    expect(snapshot.entitlement.features['pmo.enabled']).toBe(false)
  })
})
