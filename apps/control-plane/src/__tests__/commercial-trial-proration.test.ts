import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { Pool } from 'pg'
import type { Principal } from '@liwan/commercial-contracts'
import { client, money, setup, url } from './commercial-helpers.js'
import { transaction } from '../db.js'
import { digestOf } from '../commercial/lifecycle.js'
import { acceptQuoteOn } from '../commercial/orders.js'
import { createQuoteForCustomer } from '../commercial/quotes.js'
import { getSubscription } from '../commercial/subscriptions.js'
import { extendTrial, startTrial } from '../commercial/trial.js'

const monthly = { unit: 'month' as const, count: 1 }
const yearly = { unit: 'year' as const, count: 1 }
const at = (iso: string) => new Date(`${iso}T09:00:00Z`)

const suite = url ? describe : describe.skip
// A 14-day trial started 2026-10-25 ends 2026-11-08. The cycle after it is 30 days monthly, 365 days yearly.
suite('trial purchases are pro-rated by cadence days (spec 0a: L6, L7)', () => {
  const pool = new Pool({ connectionString: url, max: 4 })
  const api = client(pool)
  const reason = 'Trial proration'
  const started = at('2026-10-25')
  let plan: any, principal: Principal
  const request = (cadence: typeof monthly | typeof yearly, users = 3) => ({ kind: 'new' as const, plan_revision_id: plan.id, bundle_revision_ids: [], cadence,
    requested_extra_branches: 0, requested_users: users, requested_storage_mb: 5120 })

  beforeAll(async () => {
    const { version } = await setup(pool)
    await api('POST', '/catalog/releases', { catalog_version: version, reason })
    const created = await api('POST', '/plans', { name: `Proration ${randomUUID()}`, audience: { kind: 'public' }, term_months: 12, currency: 'SAR',
      prices: [{ cadence: monthly, amount: money(30000) }, { cadence: yearly, amount: money(360000) }], platform_limits: {},
      included_bundle_revision_ids: [], optional_bundle_revision_ids: [],
      included_extra_branches: 0, extra_branch_prices: [{ cadence: monthly, amount: money(0) }, { cadence: yearly, amount: money(0) }], extra_branches_limit: null,
      included_users: 3, included_storage_mb: 5120, storage_step_mb: 10240, storage_step_threshold_mb: 102400, storage_large_step_mb: 102400,
      user_prices: [{ cadence: monthly, amount: money(10000) }, { cadence: yearly, amount: money(120000) }],
      storage_prices: [{ cadence: monthly, amount: money(0) }, { cadence: yearly, amount: money(0) }],
      policy_revision_id: '6f1c3d8e-0000-4000-8000-000000000001', trial_days: 14, grace_days: 7, auto_suspend: true, auto_renew_allowed: true })
    const validated = await api('POST', `/plans/${created.body.id}/validate`, { edit_revision: 1, reason })
    plan = (await api('POST', `/plans/${created.body.id}/publish`, { edit_revision: validated.body.edit_revision, reason })).body
    const tenant = randomUUID()
    await pool.query("INSERT INTO tenants(id,name,commercial_mode,hosting_model,inventory_target,operations_enabled) VALUES($1,'Proration','saas','dedicated_managed',$2,true)", [tenant, `proration-${tenant}`])
    principal = { actor_id: '7', kind: 'customer', customer_id: '', tenant_id: tenant, capabilities: ['subscription.manage'] } as Principal
  })
  afterAll(async () => { await pool.end() })

  /** A customer whose trial started on 2026-10-25 and whose workspace is active. */
  async function trialing(cadence: typeof monthly | typeof yearly) {
    const id = randomUUID(), tenant = randomUUID()
    await pool.query("INSERT INTO tenants(id,name,commercial_mode,hosting_model,inventory_target,operations_enabled) VALUES($1,'Trial customer','saas','dedicated_managed',$2,true)", [tenant, `trial-${tenant}`])
    await pool.query('INSERT INTO customers(id,name,tenant_id,admin_login) VALUES($1,$2,$3,$4)', [id, 'Trial customer', tenant, `${id}@example.test`])
    const slug = `t${tenant.replaceAll('-', '')}`
    await pool.query('INSERT INTO shared_registry_bindings(control_tenant_id,tenant_id,host,database_name,filestore,enabled,registry_revision) VALUES($1,$2,$3,$4,$4,true,1)', [tenant, slug, `${slug}.trial.test`, `liwan_scratch_${slug.slice(1)}`])
    const owner = { ...principal, customer_id: id, tenant_id: tenant } as Principal
    await startTrial(pool, { customer_id: id, request: request(cadence), principal: owner, now: started })
    await pool.query('UPDATE subscriptions SET applied_revision_id=target_revision_id,target_revision_id=NULL,revision=revision+1 WHERE customer_id=$1', [id])
    await pool.query("UPDATE orders SET fulfillment_state='applied' WHERE customer_id=$1", [id])
    return { id, owner }
  }
  /** Two more paid users on the trial configuration: a 20000 monthly (240000 yearly) delta. */
  async function changeQuote(id: string, cadence: typeof monthly | typeof yearly, now: Date) {
    const sub = await getSubscription(pool, id)
    return createQuoteForCustomer(pool, { customer_id: id, request: { ...request(cadence, 5), kind: 'change', subscription_id: sub.id } }, now)
  }
  const usersDelta = (q: { lines: { key: string; amount: { minor: number } }[] }) => q.lines.find(l => l.key === 'users:delta')!.amount.minor

  it.each([
    ['day 1', '2026-10-26', 8667, 18571],
    ['mid-trial', '2026-11-01', 4667, 10000],
    ['last day', '2026-11-07', 667, 1429],
  ])('monthly %s: days left over the 30-day cycle after the trial', async (_label, day, minor) => {
    const c = await trialing(monthly)
    const q = await changeQuote(c.id, monthly, at(day))
    expect(usersDelta(q)).toBe(minor)
    expect(q.due_now.minor).toBe(minor + Math.round(minor * 0.15))
  })
  it.each([
    ['day 1', '2026-10-26', 8548],
    ['mid-trial', '2026-11-01', 4603],
    ['last day', '2026-11-07', 658],
  ])('annual %s: days left over the 365-day cycle after the trial', async (_label, day, minor) => {
    const c = await trialing(yearly)
    expect(usersDelta(await changeQuote(c.id, yearly, at(day)))).toBe(minor)
  })

  it('a non-trial subscription is still pro-rated over its own period', async () => {
    const c = await trialing(monthly)
    await pool.query("UPDATE subscriptions SET state='active',trial_ends_at=NULL,revision=revision+1 WHERE customer_id=$1", [c.id])
    // The applied period is 2026-10-25 -> 2026-11-08 (14 days); 13 days remain on 2026-10-26.
    expect(usersDelta(await changeQuote(c.id, monthly, at('2026-10-26')))).toBe(18571)
  })

  it('an extended trial stays quotable after its original end date, priced to the new end', async () => {
    const c = await trialing(monthly)
    await extendTrial(pool, { subscription_id: (await getSubscription(pool, c.id)).id, days: 7, reason: 'vendor grant', actor: 'vendor' })
    // Trial now ends 2026-11-15, the cycle after it is 30 days: 5 days left on 2026-11-10 -> 20000 * 5 / 30.
    const quote = await changeQuote(c.id, monthly, at('2026-11-10'))
    expect(usersDelta(quote)).toBe(3333)
    expect(quote.next_renewal_at).toBe('2026-11-15')
    // The old end date itself is priced to the new end as well: 7 days left.
    expect(usersDelta(await changeQuote(c.id, monthly, at('2026-11-08')))).toBe(4667)
  })
  it('writes the derived period end into the accepted snapshot and leaves the applied revision unchanged', async () => {
    const c = await trialing(monthly)
    const sub = (await pool.query('SELECT id,applied_revision_id FROM subscriptions WHERE customer_id=$1', [c.id])).rows[0]
    const appliedBefore = (await pool.query('SELECT id,snapshot FROM subscription_revisions WHERE id=$1', [sub.applied_revision_id])).rows[0]
    expect(appliedBefore.snapshot.period_end).toBe('2026-11-08')
    await extendTrial(pool, { subscription_id: sub.id, days: 7, reason: 'vendor grant', actor: 'vendor' })
    const quote = await changeQuote(c.id, monthly, at('2026-11-10'))
    const input = { quote_id: quote.id, expected_subscription_revision: quote.expected_subscription_revision, idempotency_key: randomUUID() }
    const { order } = await transaction(pool, tx => acceptQuoteOn(tx, input as any, digestOf(input), quote, c.owner, at('2026-11-10')))
    const target = (await pool.query('SELECT snapshot FROM subscription_revisions WHERE id=$1', [order.target_revision_id])).rows[0].snapshot
    expect(target.period_end).toBe('2026-11-15')
    expect(target.period_start).toBe('2026-10-25')
    const appliedAfter = (await pool.query('SELECT snapshot FROM subscription_revisions WHERE id=$1', [sub.applied_revision_id])).rows[0]
    expect(appliedAfter.snapshot).toEqual(appliedBefore.snapshot)
  })
})
