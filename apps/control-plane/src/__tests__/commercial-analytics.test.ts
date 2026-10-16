import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { Pool } from 'pg'
import { setup, client, money, monthly } from './commercial-helpers.js'
import { seedAttempt, seedCustomer, seedInvoice } from './analytics-fixtures.js'
import { routesB } from '../commercial/routes-b.js'
import { CommercialHttpError } from '../commercial/lifecycle.js'
import { getAnalytics } from '../commercial/analytics.js'
import { bookAt, monthEnds, periodBounds, previousPeriod, recurringOf, riyadhDay, settleTrials, toTimelines, type AppliedOrder } from '../commercial/analytics-model.js'

const url = process.env.CONTROL_TEST_DATABASE_URL
if (url && new URL(url).pathname !== '/nasq_control_scratch_analytics') throw new Error('analytics tests require their own scratch DB')
const suite = url ? describe : describe.skip
const now = new Date('2026-10-15T12:00:00Z')
const period = { from: '2026-10-01', to: '2026-10-15' }

describe('analytics model', () => {
  it('prices a revision per month for any cadence, with the paid extra branches split out', () => {
    expect(recurringOf({ base_minor: 120000, bundle_minor: { a: 6000 }, paid_extra_branches: 2, branch_unit_minor: 1200 }, { unit: 'year', count: 1 }))
      .toEqual({ cycle_minor: 128400, mrr_minor: 10700, branch_mrr_minor: 200, arr_minor: 128400 })
    expect(recurringOf({ base_minor: 30000, bundle_minor: {}, paid_extra_branches: 0, branch_unit_minor: 0 }, { unit: 'month', count: 3 }).mrr_minor).toBe(10000)
  })
  it('compares against the period of equal length right before, and lists twelve month ends', () => {
    expect(previousPeriod(period)).toEqual({ from: '2026-09-16', to: '2026-09-30' })
    const months = monthEnds('2026-02-10', 12)
    expect(months[0]!.month).toBe('2025-03')
    expect(months[11]).toEqual({ month: '2026-02', end: Date.parse('2026-02-28T21:00:00Z') })
  })
  it('keeps ARR exact instead of twelve times the rounded MRR', () => {
    const quarterly = recurringOf({ base_minor: 10000, bundle_minor: {}, paid_extra_branches: 0, branch_unit_minor: 0 }, { unit: 'month', count: 3 })
    expect([quarterly.mrr_minor, quarterly.arr_minor]).toEqual([3333, 40000])
  })
  it('cuts days at Asia/Riyadh midnight, not UTC', () => {
    expect(periodBounds({ from: '2026-10-01', to: '2026-10-01' })).toEqual({ start: Date.parse('2026-09-30T21:00:00Z'), end: Date.parse('2026-10-01T21:00:00Z') })
    expect(riyadhDay(Date.parse('2026-10-15T22:00:00Z'))).toBe('2026-10-16')
    expect(riyadhDay(Date.parse('2026-10-15T20:59:00Z'))).toBe('2026-10-15')
  })
  it('starts billing at the end of the trial, with only the last order inside the trial kept', () => {
    const order = (applied: string, mrr: number): AppliedOrder => ({ subscription_id: 's', applied_at: Date.parse(applied), plan_id: 'p', plan_name: 'P', mrr_minor: mrr, branch_mrr_minor: 0, cycle_minor: mrr, arr_minor: mrr * 12 })
    const trialEnd = Date.parse('2026-10-08T00:00:00Z')
    const timelines = settleTrials(toTimelines([order('2026-09-20T00:00:00Z', 100), order('2026-09-25T00:00:00Z', 200)]), new Map([['s', trialEnd]]))
    expect(timelines.get('s')!.map(o => [o.applied_at, o.mrr_minor])).toEqual([[trialEnd, 200]])
    expect(bookAt(timelines, Date.parse('2026-10-01T00:00:00Z')).mrr_minor).toBe(0)
    expect(bookAt(timelines, Date.parse('2026-10-09T00:00:00Z')).mrr_minor).toBe(200)
  })
})

suite('live PostgreSQL vendor analytics', () => {
  const pool = new Pool({ connectionString: url, max: 4 })
  let p1: string, p2: string
  let a: Awaited<ReturnType<typeof seedCustomer>>, b: Awaited<ReturnType<typeof seedCustomer>>, j: Awaited<ReturnType<typeof seedCustomer>>
  async function plan(name: string) {
    const c = await client(pool)('POST', '/plans', { name, audience: { kind: 'public' }, term_months: 12, currency: 'SAR', prices: [{ cadence: monthly, amount: money(10000) }], platform_limits: { 'users.limit': null, 'storage.limit_mb': null }, included_bundle_revision_ids: [], optional_bundle_revision_ids: [], included_extra_branches: 0, extra_branch_prices: [], extra_branches_limit: null, policy_revision_id: '6f1c3d8e-0000-4000-8000-000000000001', trial_days: 0, grace_days: 5, auto_suspend: true, auto_renew_allowed: false, reason: 'Analytics fixture' })
    expect(c.status).toBe(201)
    return c.body.id as string
  }
  beforeAll(async () => {
    const { version } = await setup(pool)
    await client(pool)('POST', '/catalog/releases', { catalog_version: version, reason: 'Analytics fixture' })
    await pool.query('TRUNCATE customers CASCADE')
    p1 = await plan(`Basic ${randomUUID()}`)
    p2 = await plan(`Pro ${randomUUID()}`)
    const yearly = { unit: 'year' as const, count: 1 }
    a = await seedCustomer(pool, { name: 'A', state: 'active', renewal_at: '2026-10-20', features: { 'users.limit': 10 }, usage: { 'users.limit': 9 }, steps: [
      { at: '2026-08-10T09:00:00Z', plan_revision_id: p1, base_minor: 10000 },
      { at: '2026-10-05T09:00:00Z', plan_revision_id: p2, base_minor: 30000 }] })
    b = await seedCustomer(pool, { name: 'B', state: 'active', renewal_at: '2026-11-20', features: { 'users.limit': 100 }, usage: { 'users.limit': 5 }, steps: [
      { at: '2026-10-03T10:00:00Z', plan_revision_id: p1, base_minor: 10000, paid_at: '2026-10-03T08:00:00Z' }] })
    await seedCustomer(pool, { name: 'C', state: 'past_due', renewal_at: '2026-12-10', steps: [
      { at: '2026-07-01T09:00:00Z', plan_revision_id: p2, base_minor: 120000, cadence: yearly, paid_extra_branches: 2, branch_unit_minor: 1200 },
      { at: '2026-10-10T09:00:00Z', plan_revision_id: p1, base_minor: 5000 }] })
    await seedCustomer(pool, { name: 'D suspended', state: 'suspended', steps: [{ at: '2026-06-01T09:00:00Z', plan_revision_id: p1, base_minor: 10000 }] })
    j = await seedCustomer(pool, { name: 'J unreadable', state: 'active', features: { 'users.limit': 10 }, usage: { 'users.limit': 1 }, steps: [
      { at: '2026-08-20T09:00:00Z', plan_revision_id: p1, base_minor: 100 }] })
    await pool.query("UPDATE usage_snapshots SET freshness='unavailable' WHERE tenant_id=$1", [j.tenant_id])
    await seedCustomer(pool, { name: 'E dollars', state: 'active', steps: [{ at: '2026-09-01T09:00:00Z', plan_revision_id: p1, base_minor: 99900, currency: 'USD' }] })
    const f = await seedCustomer(pool, { name: 'F converted', state: 'active', trial_ends_at: '2026-10-05T00:00:00Z' })
    await seedInvoice(pool, { customer_id: f.customer_id, subscription_id: f.subscription_id, status: 'paid', total_minor: 5000, issued_at: '2026-10-05T00:00:00Z', due_at: '2026-10-12T00:00:00Z', paid_at: '2026-10-06T00:00:00Z' })
    await seedCustomer(pool, { name: 'G unconverted', state: 'trialing', trial_ends_at: '2026-10-07T00:00:00Z' })
    await seedCustomer(pool, { name: 'H stuck', state: 'active', steps: [
      { at: '2026-10-14T08:00:00Z', plan_revision_id: p1, base_minor: 100, fulfillment_state: 'failed' },
      { at: '2026-10-15T08:00:00Z', plan_revision_id: p1, base_minor: 100, fulfillment_state: 'queued' },
      { at: '2026-10-15T11:55:00Z', plan_revision_id: p1, base_minor: 100, fulfillment_state: 'queued' }] })
    const unpaid = (customer: typeof a, issued: string, due: string, total: number) => seedInvoice(pool, { customer_id: customer.customer_id, subscription_id: customer.subscription_id, status: 'issued', total_minor: total, issued_at: issued, due_at: due })
    await unpaid(a, '2026-09-01T00:00:00Z', '2026-09-15T00:00:00Z', 5000)
    await unpaid(a, '2026-10-01T00:00:00Z', '2026-10-10T00:00:00Z', 7000)
    await unpaid(a, '2026-07-01T00:00:00Z', '2026-07-15T00:00:00Z', 3000)
    await seedInvoice(pool, { customer_id: a.customer_id, subscription_id: a.subscription_id, order_id: a.orders[1]!.id, status: 'paid', total_minor: 23000, tax_minor: 3000, issued_at: '2026-10-08T00:00:00Z', due_at: '2026-10-15T00:00:00Z', paid_at: '2026-10-10T00:00:00Z' })
    // Paid before it was issued (bad data): counts as collected, but must not make the average negative.
    await seedInvoice(pool, { customer_id: a.customer_id, subscription_id: a.subscription_id, status: 'paid', total_minor: 1000, issued_at: '2026-10-06T00:00:00Z', due_at: '2026-10-20T00:00:00Z', paid_at: '2026-10-04T00:00:00Z' })
    const invoice = b.orders[0]!.invoice_id!
    for (const status of ['succeeded', 'succeeded', 'succeeded', 'failed'] as const) {
      await seedAttempt(pool, { order_id: b.orders[0]!.id, invoice_id: invoice, status, at: '2026-10-04T00:00:00Z' })
    }
    await pool.query("UPDATE fulfillment_effects SET applied_at='2026-10-03T10:00:00Z' WHERE order_id=$1", [b.orders[0]!.id])
  })
  afterAll(async () => { await pool.end() })

  const minor = (figure: any) => (figure.available ? figure.value.minor : figure)

  it('computes revenue and movement for the period, from every subscription', async () => {
    const data = await getAnalytics(pool, period, now)
    expect(data.currency).toBe('SAR')
    expect(data.excluded_subscriptions).toBe(1)
    const r = data.current.revenue
    expect([minor(r.mrr), minor(r.arr), minor(r.new_mrr), minor(r.expansion_mrr), minor(r.contraction_mrr), minor(r.arpc)])
      .toEqual([45100, 541200, 10000, 20000, 5200, 11275])
    expect(r.churned_mrr).toEqual({ available: false, reason: 'no_cancellation_date' })
    expect(data.current.customers.active).toEqual({ available: true, value: 4 })
    expect(data.current.customers.new).toEqual({ available: true, value: 1 })
    expect(data.current.customers.churn_rate_by_count.available).toBe(false)
    expect(data.trend).toHaveLength(12)
    expect(data.trend[11]).toMatchObject({ month: '2026-10', customers: { available: true, value: 4 } })
    expect(minor(data.trend[11]!.mrr)).toBe(45100)
  })

  it('does not restate the past while a subscription that left service had revenue in it', async () => {
    // D (suspended) was billing from June; the schema keeps no suspension time, so September cannot be told apart.
    const data = await getAnalytics(pool, period, now)
    const lost = { available: false, reason: 'history_not_recorded' }
    const p = data.previous.revenue
    expect([p.mrr, p.arr, p.arpc, p.extra_branch_mrr, data.previous.customers.active]).toEqual([lost, lost, lost, lost, lost])
    expect(data.previous.revenue.new_mrr).toEqual({ available: true, value: expect.objectContaining({ minor: 0 }) })
    expect(data.trend[10]).toMatchObject({ month: '2026-09', mrr: lost, customers: lost })
    expect(data.trend[4]).toMatchObject({ month: '2026-03', customers: { available: true, value: 0 } })
    expect(data.trend[0]!.mrr.available).toBe(true)
  })

  it('restates the past when nobody has left service', async () => {
    const solo = new Pool({ connectionString: url, max: 1 })
    try {
      await solo.query('BEGIN')
      await solo.query("UPDATE subscriptions SET state='active', revision=revision+1 WHERE state='suspended'")
      const data = await getAnalytics(solo, period, now)
      expect(minor(data.previous.revenue.mrr)).toBe(30300)
      expect(minor(data.previous.revenue.extra_branch_mrr)).toBe(200)
      expect(data.trend[10]).toMatchObject({ month: '2026-09', customers: { available: true, value: 4 } })
      expect(minor(data.trend[10]!.mrr)).toBe(30300)
      expect(minor(data.trend[8]!.mrr)).toBe(20200)
      await solo.query('ROLLBACK')
    } finally { await solo.end() }
  })

  it('computes collection, ageing, payment success and trial conversion', async () => {
    const { current, previous } = await getAnalytics(pool, period, now)
    const c = current.collection
    expect([minor(c.collected), minor(c.outstanding), minor(c.overdue_0_30), minor(c.overdue_31_60), minor(c.overdue_61_plus)]).toEqual([36000, 15000, 7000, 5000, 3000])
    expect(c.payment_success_rate).toEqual({ available: true, value: 0.75 })
    expect((c.avg_days_to_pay as any).value).toBeCloseTo((1 / 3 + 2 + 1) / 3, 4)
    expect(minor(c.collected)).toBe(36000) // A's 23000 paid invoice counts its 20000 before-tax part
    expect([minor(previous.collection.outstanding), minor(previous.collection.overdue_0_30), minor(previous.collection.overdue_61_plus)]).toEqual([8000, 5000, 3000])
    expect(previous.collection.payment_success_rate).toEqual({ available: false, reason: 'no_data' })
    expect(current.customers.trial_conversion_rate).toEqual({ available: true, value: 0.5 })
    expect((current.operations.avg_hours_to_ready as any).value).toBeCloseTo(2, 4)
  })

  it('reports the present book: states, plans, plan changes, renewals, limits and stalled fulfillments', async () => {
    const { snapshot } = await getAnalytics(pool, period, now)
    expect(snapshot.states.find(s => s.state === 'suspended')?.count).toBe(1)
    expect(snapshot.plans.map(plan => [plan.customers, plan.mrr.minor])).toEqual([[1, 30000], [3, 15100]])
    expect(snapshot.plan_changes.map(change => [change.direction, change.count]).sort()).toEqual([['downgrade', 1], ['upgrade', 1]])
    expect(snapshot.renewals.map(r => [r.within_days, r.count, r.value.minor])).toEqual([[30, 1, 30000], [60, 3, 45000], [90, 3, 45000]])
    expect(snapshot.upsell.map(u => [u.customer_name, u.ratio])).toEqual([['A', 0.9]])
    expect(snapshot.low_usage.map(u => u.customer_name)).toEqual(['B'])
    expect(snapshot.usage_unavailable).toBe(1)
    expect(snapshot.stalled_fulfillments.count).toBe(2)
    expect(snapshot.stalled_fulfillments.items.map(i => i.fulfillment_state).sort()).toEqual(['failed', 'queued'])
  })

  it('answers over HTTP for billing managers only and rejects bad periods', async () => {
    const call = async (capabilities: any[], query: string) => {
      const pathname = '/v1/commercial/analytics'
      try {
        const r = await routesB(pool, { method: 'GET', pathname, raw: '', issuer: 'commercial-test', actor: 7, capabilities } as any, new URL(`${pathname}?${query}`, 'http://localhost'))
        return { status: r!.status, body: r!.data as any }
      } catch (e) {
        if (e instanceof CommercialHttpError) return { status: e.status, body: { code: e.code } as any }
        throw e
      }
    }
    const finance = ['vendor.read', 'vendor.billing.manage']
    const ok = await call(finance, 'from=2026-10-01&to=2026-10-15')
    expect(ok.status).toBe(200)
    expect(ok.body.period).toEqual(period)
    expect((await call(['vendor.read'], 'from=2026-10-01&to=2026-10-15')).status).toBe(403)
    expect((await call(finance, 'from=2026-10-15&to=2026-10-01')).status).toBe(422)
    expect((await call(finance, 'from=2026-10-01')).status).toBe(422)
    expect((await call(finance, 'from=2020-01-01&to=2026-10-01')).status).toBe(422)
  })

  it('shows an empty book as zero money and unavailable ratios', async () => {
    const empty = new Pool({ connectionString: url, max: 1 })
    try {
      await empty.query('BEGIN')
      await empty.query('TRUNCATE customers CASCADE')
      const data = await getAnalytics(empty, period, now)
      expect(data.current.revenue.mrr).toMatchObject({ available: true, value: { minor: 0 } })
      expect(data.current.revenue.arpc).toEqual({ available: false, reason: 'no_data' })
      expect(data.trend.every(point => minor(point.mrr) === 0)).toBe(true)
      await empty.query('ROLLBACK')
    } finally { await empty.end() }
  })
})
