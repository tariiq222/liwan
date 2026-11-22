import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { Pool } from 'pg'
import { setup, client, money, monthly } from './commercial-helpers.js'
import { seedAttempt, seedCustomer, seedInvoice, seedSignup, type SignupInput } from './analytics-fixtures.js'
import { routesB } from '../commercial/routes-b.js'
import { CommercialHttpError } from '../commercial/lifecycle.js'
import { getAnalytics } from '../commercial/analytics.js'
import { signupFunnel } from '../commercial/signup-funnel.js'
import { bookAt, monthEnds, periodBounds, previousPeriod, recurringOf, riyadhDay, settleTrials, toTimelines, type AppliedOrder } from '../commercial/analytics-model.js'

const url = process.env.CONTROL_TEST_DATABASE_URL
if (url && !/^\/liwan_control_scratch_analytics[a-z0-9]*$/.test(new URL(url).pathname)) throw new Error('analytics tests require their own scratch DB')
const suite = url ? describe : describe.skip
const now = new Date('2026-10-15T12:00:00Z')
const period = { from: '2026-10-01', to: '2026-10-15' }

describe('analytics model', () => {
  it('prices a revision per month for any cadence, with the paid extra branches split out', () => {
    expect(recurringOf({ base_minor: 120000, bundle_minor: { a: 6000 }, paid_extra_branches: 2, branch_unit_minor: 1200, paid_users: 0, user_unit_minor: 0, paid_storage_gb: 0, storage_unit_minor: 0 }, { unit: 'year', count: 1 }))
      .toEqual({ cycle_minor: 128400, mrr_minor: 10700, branch_mrr_minor: 200, arr_minor: 128400 })
    expect(recurringOf({ base_minor: 30000, bundle_minor: {}, paid_extra_branches: 0, branch_unit_minor: 0, paid_users: 0, user_unit_minor: 0, paid_storage_gb: 0, storage_unit_minor: 0 }, { unit: 'month', count: 3 }).mrr_minor).toBe(10000)
  })
  it('counts paid users and paid storage in recurring revenue, as the renewal invoice does', () => {
    const pricing = { base_minor: 10000, bundle_minor: {}, paid_extra_branches: 0, branch_unit_minor: 0, paid_users: 3, user_unit_minor: 500, paid_storage_gb: 2, storage_unit_minor: 250 }
    expect(recurringOf(pricing, { unit: 'month', count: 1 })).toEqual({ cycle_minor: 12000, mrr_minor: 12000, branch_mrr_minor: 0, arr_minor: 144000 })
  })
  it('compares against the period of equal length right before, and lists twelve month ends', () => {
    expect(previousPeriod(period)).toEqual({ from: '2026-09-16', to: '2026-09-30' })
    const months = monthEnds('2026-02-10', 12)
    expect(months[0]!.month).toBe('2025-03')
    expect(months[11]).toEqual({ month: '2026-02', end: Date.parse('2026-02-28T21:00:00Z') })
  })
  it('keeps ARR exact instead of twelve times the rounded MRR', () => {
    const quarterly = recurringOf({ base_minor: 10000, bundle_minor: {}, paid_extra_branches: 0, branch_unit_minor: 0, paid_users: 0, user_unit_minor: 0, paid_storage_gb: 0, storage_unit_minor: 0 }, { unit: 'month', count: 3 })
    expect([quarterly.mrr_minor, quarterly.arr_minor]).toEqual([3333, 40000])
  })
  it('cuts days at Asia/Riyadh midnight, not UTC', () => {
    expect(periodBounds({ from: '2026-10-01', to: '2026-10-01' })).toEqual({ start: Date.parse('2026-09-30T21:00:00Z'), end: Date.parse('2026-10-01T21:00:00Z') })
    expect(riyadhDay(Date.parse('2026-10-15T22:00:00Z'))).toBe('2026-10-16')
    expect(riyadhDay(Date.parse('2026-10-15T20:59:00Z'))).toBe('2026-10-15')
  })
  it('starts billing at the end of the trial, with only the last order inside the trial kept', () => {
    const order = (applied: string, mrr: number): AppliedOrder => ({ subscription_id: 's', applied_at: Date.parse(applied), plan_id: 'p', plan_name: 'P', mrr_minor: mrr, branch_mrr_minor: 0, cycle_minor: mrr, arr_minor: mrr * 12, paying: true })
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
    const c = await client(pool)('POST', '/plans', { name, audience: { kind: 'public' }, term_months: 12, currency: 'SAR', prices: [{ cadence: monthly, amount: money(10000) }], platform_limits: {}, included_bundle_revision_ids: [], optional_bundle_revision_ids: [], included_extra_branches: 0, extra_branch_prices: [], extra_branches_limit: null, included_users: 1, included_storage_mb: 0, storage_step_mb: 10240, storage_step_threshold_mb: 102400, storage_large_step_mb: 102400, user_prices: [{ cadence: monthly, amount: money(0) }], storage_prices: [{ cadence: monthly, amount: money(0) }], policy_revision_id: '6f1c3d8e-0000-4000-8000-000000000001', trial_days: 0, grace_days: 5, auto_suspend: true, auto_renew_allowed: false, reason: 'Analytics fixture' })
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
    const d = await seedCustomer(pool, { name: 'D suspended', state: 'suspended', steps: [{ at: '2026-06-01T09:00:00Z', plan_revision_id: p1, base_minor: 10000 }] })
    await pool.query("UPDATE subscriptions SET left_service_at='2026-09-20T00:00:00Z' WHERE id=$1", [d.subscription_id])
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
    expect(r.churned_mrr).toMatchObject({ available: true, value: { minor: 0 } })
    expect(data.current.customers.active).toEqual({ available: true, value: 4 })
    expect(data.current.customers.new).toEqual({ available: true, value: 1 })
    expect(data.current.customers.churned).toEqual({ available: true, value: 0 })
    expect(data.trend).toHaveLength(12)
    expect(data.trend[11]).toMatchObject({ month: '2026-10', customers: { available: true, value: 4 } })
    expect(minor(data.trend[11]!.mrr)).toBe(45100)
  })

  it('restates the past exactly for a subscription whose departure time is recorded', async () => {
    // D (suspended) billed from June and left service on 20 September: it is in the book before then and out of it after.
    const data = await getAnalytics(pool, period, now)
    expect(minor(data.previous.revenue.mrr)).toBe(20300)
    expect(minor(data.previous.revenue.extra_branch_mrr)).toBe(200)
    expect(data.previous.customers.active).toEqual({ available: true, value: 3 })
    expect(data.trend[10]).toMatchObject({ month: '2026-09', customers: { available: true, value: 3 } })
    expect(minor(data.trend[10]!.mrr)).toBe(20300)
    expect(data.trend[9]).toMatchObject({ month: '2026-08', customers: { available: true, value: 4 } })
    expect(minor(data.trend[9]!.mrr)).toBe(30300)
    expect(data.trend[4]).toMatchObject({ month: '2026-03', customers: { available: true, value: 0 } })
    expect(data.current.customers.active).toEqual({ available: true, value: 4 })
  })

  it('does not restate the past for a subscription that left service before the time was recorded', async () => {
    const solo = new Pool({ connectionString: url, max: 1 })
    try {
      await solo.query('BEGIN')
      await solo.query("UPDATE subscriptions SET left_service_at=NULL WHERE state='suspended'")
      const data = await getAnalytics(solo, period, now)
      const lost = { available: false, reason: 'history_not_recorded' }
      const p = data.previous.revenue
      expect([p.mrr, p.arr, p.arpc, p.extra_branch_mrr, data.previous.customers.active]).toEqual([lost, lost, lost, lost, lost])
      expect(data.previous.revenue.new_mrr).toEqual({ available: true, value: expect.objectContaining({ minor: 0 }) })
      expect(data.trend[10]).toMatchObject({ month: '2026-09', mrr: lost, customers: lost })
      expect(data.trend[4]).toMatchObject({ month: '2026-03', customers: { available: true, value: 0 } })
      expect(data.trend[0]!.mrr.available).toBe(true)
      await solo.query('ROLLBACK')
    } finally { await solo.end() }
  })

  it('records when a subscription leaves service and clears it on return', async () => {
    const solo = new Pool({ connectionString: url, max: 1 })
    try {
      await solo.query('BEGIN')
      const sub = (await solo.query("SELECT id FROM subscriptions WHERE state='active' LIMIT 1")).rows[0].id
      const left = async () => (await solo.query('SELECT left_service_at FROM subscriptions WHERE id=$1', [sub])).rows[0].left_service_at
      expect(await left()).toBeNull()
      await solo.query("UPDATE subscriptions SET state='suspended',revision=revision+1 WHERE id=$1", [sub])
      const first = await left()
      expect(first).toBeInstanceOf(Date)
      await solo.query("UPDATE subscriptions SET state='cancelled',revision=revision+1 WHERE id=$1", [sub])
      expect(await left()).toEqual(first)
      await solo.query("UPDATE subscriptions SET state='active',revision=revision+1 WHERE id=$1", [sub])
      expect(await left()).toBeNull()
      await solo.query('ROLLBACK')
    } finally { await solo.end() }
  })

  it('leaves free-base customers out of ARPC and of the renewal count and value, but not out of the customer totals', async () => {
    const solo = new Pool({ connectionString: url, max: 1 })
    try {
      await solo.query('BEGIN')
      await seedCustomer(solo, { name: 'L free base', state: 'active', renewal_at: '2026-10-25', steps: [{ at: '2026-09-01T09:00:00Z', plan_revision_id: p1, base_minor: 0 }] })
      const data = await getAnalytics(solo, period, now)
      expect(data.current.customers.active).toEqual({ available: true, value: 5 })
      expect(minor(data.current.revenue.mrr)).toBe(45100)
      expect(minor(data.current.revenue.arpc)).toBe(11275)
      expect(data.snapshot.renewals.map(r => [r.within_days, r.count, r.value.minor])).toEqual([[30, 1, 30000], [60, 3, 45000], [90, 3, 45000]])
      expect(data.snapshot.plans.reduce((sum, plan) => sum + plan.customers, 0)).toBe(5)
      await solo.query('ROLLBACK')
    } finally { await solo.end() }
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

  it('books a lapsed trial from its boundary with only what the lock keeps, not the trial apps a paid upgrade carried', async () => {
    const solo = new Pool({ connectionString: url, max: 1 })
    try {
      await solo.query('BEGIN')
      const before = await getAnalytics(solo, period, now)
      const lapsed = await seedCustomer(solo, { name: 'K lapsed', state: 'active', steps: [
        { at: '2026-09-20T09:00:00Z', plan_revision_id: p1, base_minor: 0 },
        // One user bought while a 19,900 bundle was only being trialed: the upgrade's snapshot still prices that bundle.
        { at: '2026-09-25T09:00:00Z', plan_revision_id: p1, base_minor: 2900, bundle_minor: { trialed: 19900 } },
        { at: '2026-10-09T09:00:00Z', plan_revision_id: p1, base_minor: 2900 }] })
      const trialRevision = (await solo.query('SELECT target_revision_id FROM orders WHERE id=$1', [lapsed.orders[0]!.id])).rows[0].target_revision_id
      await solo.query(`INSERT INTO free_base_locks(subscription_id,pre_lock_revision_id,period_start,armed_at,trial_ended_at,cause,state)
        VALUES($1,$2,'2026-10-05','2026-10-05T00:05:00Z','2026-10-05T00:00:00Z','trial_end','done')`, [lapsed.subscription_id, trialRevision])
      const after = await getAnalytics(solo, period, now)
      // Only the lock's 2,900 is recurring, and it is booked at the trial boundary (October 5), inside the period, as new revenue.
      expect(minor(after.current.revenue.mrr) - minor(before.current.revenue.mrr)).toBe(2900)
      expect(minor(after.current.revenue.new_mrr) - minor(before.current.revenue.new_mrr)).toBe(2900)
      expect(minor(after.current.revenue.expansion_mrr)).toBe(minor(before.current.revenue.expansion_mrr))
      expect(minor(after.current.revenue.contraction_mrr)).toBe(minor(before.current.revenue.contraction_mrr))
      // Nothing was booked on the upgrade date (September 25) from the unpaid bundle.
      expect(minor(after.previous.revenue.new_mrr)).toBe(minor(before.previous.revenue.new_mrr))
      expect(minor(after.trend[11]!.mrr) - minor(before.trend[11]!.mrr)).toBe(2900)
      await solo.query('ROLLBACK')
    } finally { await solo.end() }
  })

  it('takes a refunded order out of MRR from the moment its free-base lock was armed', async () => {
    const solo = new Pool({ connectionString: url, max: 1 })
    try {
      await solo.query('BEGIN')
      const before = await getAnalytics(solo, period, now)
      const paid = await seedCustomer(solo, { name: 'M refunded', state: 'active', steps: [{ at: '2026-10-02T09:00:00Z', plan_revision_id: p1, base_minor: 5000 }] })
      const booked = await getAnalytics(solo, period, now)
      expect(minor(booked.current.revenue.mrr) - minor(before.current.revenue.mrr)).toBe(5000)
      const revision = (await solo.query('SELECT target_revision_id FROM orders WHERE id=$1', [paid.orders[0]!.id])).rows[0].target_revision_id
      await solo.query(`INSERT INTO free_base_locks(subscription_id,pre_lock_revision_id,period_start,armed_at,cause,state)
        VALUES($1,$2,'2026-10-02','2026-10-08T09:00:00Z','refund','pending')`, [paid.subscription_id, revision])
      const after = await getAnalytics(solo, period, now)
      expect(minor(after.current.revenue.mrr)).toBe(minor(before.current.revenue.mrr))
      await solo.query('ROLLBACK')
    } finally { await solo.end() }
  })

  it('counts neither the conversion nor the money of a converted trial whose payment was refunded in full', async () => {
    const solo = new Pool({ connectionString: url, max: 1 })
    try {
      await solo.query('BEGIN')
      const before = await getAnalytics(solo, period, now)
      const refunded = await seedCustomer(solo, { name: 'L refunded', state: 'active', trial_ends_at: '2026-10-06T00:00:00Z' })
      const invoice = await seedInvoice(solo, { customer_id: refunded.customer_id, subscription_id: refunded.subscription_id, status: 'paid', total_minor: 8000,
        issued_at: '2026-10-06T00:00:00Z', due_at: '2026-10-13T00:00:00Z', paid_at: '2026-10-07T00:00:00Z' })
      const counted = await getAnalytics(solo, period, now)
      expect(minor(counted.current.collection.collected) - minor(before.current.collection.collected)).toBe(8000)
      await solo.query(`INSERT INTO invoice_adjustments(id,invoice_id,customer_id,kind,reason,amount_minor,currency,exponent,status,created_by,origin,cause,refund_reference,refunded_at,refunded_by)
        VALUES($1,$2,$3,'credit_note','Customer asked within 14 days',8000,'SAR',2,'refunded','vendor-test','vendor','vendor_refund','MOY-L-1',now(),'vendor-test')`,
      [randomUUID(), invoice, refunded.customer_id])
      const after = await getAnalytics(solo, period, now)
      expect(minor(after.current.collection.collected)).toBe(minor(before.current.collection.collected))
      // One more ended trial and no more paid ones: the refunded conversion lowers the rate instead of raising it.
      expect(after.current.customers.trial_conversion_rate).toEqual({ available: true, value: 1 / 3 })
      await solo.query('ROLLBACK')
    } finally { await solo.end() }
  })

  it('does not count an invoice due later today as overdue', async () => {
    const solo = new Pool({ connectionString: url, max: 1 })
    try {
      await solo.query('BEGIN')
      const before = (await getAnalytics(solo, period, now)).current.collection
      // Due at 18:00 Riyadh today; the report runs at 15:00 Riyadh, so it is open but not late yet.
      await seedInvoice(solo, { customer_id: a.customer_id, subscription_id: a.subscription_id, status: 'issued', total_minor: 4000, issued_at: '2026-10-14T00:00:00Z', due_at: '2026-10-15T15:00:00Z' })
      const after = (await getAnalytics(solo, period, now)).current.collection
      expect(minor(after.outstanding)).toBe(minor(before.outstanding) + 4000)
      expect([minor(after.overdue_0_30), minor(after.overdue_31_60), minor(after.overdue_61_plus)])
        .toEqual([minor(before.overdue_0_30), minor(before.overdue_31_60), minor(before.overdue_61_plus)])
      await solo.query('ROLLBACK')
    } finally { await solo.end() }
  })

  it('does not count a paid AI top-up as a trial conversion', async () => {
    const solo = new Pool({ connectionString: url, max: 1 })
    try {
      await solo.query('BEGIN')
      const lapsed = await seedCustomer(solo, { name: 'L top-up only', state: 'active', trial_ends_at: '2026-10-05T00:00:00Z' })
      const invoice = await seedInvoice(solo, { customer_id: lapsed.customer_id, subscription_id: lapsed.subscription_id, status: 'paid', total_minor: 5000, issued_at: '2026-10-06T00:00:00Z', due_at: '2026-10-06T00:00:00Z', paid_at: '2026-10-06T00:00:00Z' })
      await solo.query(`INSERT INTO invoice_lines(id,invoice_id,position,key,kind,timing,description,quantity,unit_minor,amount_minor,currency,exponent,period_start,period_end,source_revision_id)
        VALUES($1,$2,0,'ai_topup','ai_topup','now','AI top-up',1,5000,5000,'SAR',2,'2026-10-06','2026-10-06',$1)`, [randomUUID(), invoice])
      // One more ended trial, paid only for a top-up: the rate falls from 1 of 2 to 1 of 3.
      expect((await getAnalytics(solo, period, now)).current.customers.trial_conversion_rate).toEqual({ available: true, value: 1 / 3 })
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

  it('counts a cancelled subscription that dropped to the free base as churn on its effective date, and keeps the paid history it dropped from', async () => {
    const before = await getAnalytics(pool, period, now)
    const k = await seedCustomer(pool, { name: 'K cancelled', state: 'active', renewal_at: '2026-11-12', steps: [
      { at: '2026-09-10T09:00:00Z', plan_revision_id: p1, base_minor: 30000, paid_at: '2026-09-10T08:00:00Z' },
      { at: '2026-10-12T00:00:00Z', plan_revision_id: p1, base_minor: 0 }] })
    const first = (await pool.query('SELECT id FROM subscription_revisions WHERE subscription_id=$1 ORDER BY revision LIMIT 1', [k.subscription_id])).rows[0].id
    await pool.query(`INSERT INTO free_base_locks(subscription_id,pre_lock_revision_id,period_start,armed_at,cause,state,order_id,next_attempt_at)
      VALUES($1,$2,'2026-10-12','2026-10-12T00:00:00Z','cancelled','done',$3,'2026-10-12T00:00:00Z')`, [k.subscription_id, first, k.orders[1]!.id])
    const after = await getAnalytics(pool, period, now)
    expect(minor(after.current.revenue.churned_mrr)).toBe(minor(before.current.revenue.churned_mrr) + 30000)
    expect(minor(after.current.revenue.contraction_mrr)).toBe(minor(before.current.revenue.contraction_mrr))
    expect(after.current.customers.churned).toEqual({ available: true, value: 1 })
    expect(after.current.customers.churn_rate_by_count).toMatchObject({ available: true })
    expect(minor(after.current.revenue.mrr)).toBe(minor(before.current.revenue.mrr))
  })

  it('keeps the history a trial-end lock excluded after the same row is rewritten for a cancellation', async () => {
    const august = { from: '2026-08-01', to: '2026-08-15' }
    const before = await getAnalytics(pool, august, now)
    const l = await seedCustomer(pool, { name: 'L trialled then cancelled', state: 'active', renewal_at: '2026-11-12', steps: [
      { at: '2026-08-01T09:00:00Z', plan_revision_id: p1, base_minor: 20000 },
      { at: '2026-08-12T09:00:00Z', plan_revision_id: p1, base_minor: 0 },
      { at: '2026-09-05T09:00:00Z', plan_revision_id: p1, base_minor: 10000, paid_at: '2026-09-05T08:00:00Z' },
      { at: '2026-10-12T00:00:00Z', plan_revision_id: p1, base_minor: 0 }] })
    const first = (await pool.query('SELECT id FROM subscription_revisions WHERE subscription_id=$1 ORDER BY revision LIMIT 1', [l.subscription_id])).rows[0].id
    await pool.query(`INSERT INTO free_base_locks(subscription_id,pre_lock_revision_id,period_start,armed_at,cause,state,order_id,next_attempt_at,excluded_until)
      VALUES($1,$2,'2026-10-12','2026-10-12T00:00:00Z','cancelled','done',$3,'2026-10-12T00:00:00Z','2026-08-10T00:00:00Z')`, [l.subscription_id, first, l.orders[3]!.id])
    const after = await getAnalytics(pool, august, now)
    // The unbilled trial-era order (20000, before the trial-end cutoff) is still not revenue.
    expect(minor(after.current.revenue.new_mrr)).toBe(minor(before.current.revenue.new_mrr))
    const autumn = await getAnalytics(pool, { from: '2026-10-01', to: '2026-10-15' }, now)
    expect(minor(autumn.current.revenue.churned_mrr)).toBeGreaterThanOrEqual(10000)
  })

  it('counts paid users and paid storage in the book, not only base, bundles and branches', async () => {
    const solo = new Pool({ connectionString: url, max: 1 })
    try {
      await solo.query('BEGIN')
      await solo.query('TRUNCATE customers CASCADE')
      await seedCustomer(solo, { name: 'P users and storage', state: 'active', steps: [
        { at: '2026-09-01T09:00:00Z', plan_revision_id: p1, base_minor: 10000, paid_users: 3, user_unit_minor: 500, paid_storage_gb: 2, storage_unit_minor: 250 }] })
      expect(minor((await getAnalytics(solo, period, now)).current.revenue.mrr)).toBe(12000)
      await solo.query('ROLLBACK')
    } finally { await solo.end() }
  })

  it('measures churn on the customers and revenue that were in the book when the period opened, so a rate never exceeds one', async () => {
    const solo = new Pool({ connectionString: url, max: 1 })
    try {
      await solo.query('BEGIN')
      await solo.query('TRUNCATE customers CASCADE')
      await seedCustomer(solo, { name: 'Opening and staying', state: 'active', steps: [{ at: '2026-09-01T09:00:00Z', plan_revision_id: p1, base_minor: 10000 }] })
      const opening = await seedCustomer(solo, { name: 'Opening and leaving', state: 'active', steps: [
        { at: '2026-09-02T09:00:00Z', plan_revision_id: p1, base_minor: 10000 }, { at: '2026-10-12T00:00:00Z', plan_revision_id: p1, base_minor: 0 }] })
      const joiners = [
        await seedCustomer(solo, { name: 'Joined then left 1', state: 'active', steps: [
          { at: '2026-10-02T09:00:00Z', plan_revision_id: p1, base_minor: 30000 }, { at: '2026-10-12T00:00:00Z', plan_revision_id: p1, base_minor: 0 }] }),
        await seedCustomer(solo, { name: 'Joined then left 2', state: 'active', steps: [
          { at: '2026-10-03T09:00:00Z', plan_revision_id: p1, base_minor: 30000 }, { at: '2026-10-12T00:00:00Z', plan_revision_id: p1, base_minor: 0 }] })]
      for (const seeded of [opening, ...joiners]) {
        const first = (await solo.query('SELECT id FROM subscription_revisions WHERE subscription_id=$1 ORDER BY revision LIMIT 1', [seeded.subscription_id])).rows[0].id
        await solo.query(`INSERT INTO free_base_locks(subscription_id,pre_lock_revision_id,period_start,armed_at,cause,state,order_id,next_attempt_at)
          VALUES($1,$2,'2026-10-12','2026-10-12T00:00:00Z','cancelled','done',$3,'2026-10-12T00:00:00Z')`, [seeded.subscription_id, first, seeded.orders[1]!.id])
      }
      const { current } = await getAnalytics(solo, period, now)
      // Every churn is still reported as a movement; the rate only asks how much of the opening book left.
      expect(current.customers.churned).toEqual({ available: true, value: 3 })
      expect(minor(current.revenue.churned_mrr)).toBe(70000)
      expect(current.customers.churn_rate_by_count).toEqual({ available: true, value: 0.5 })
      expect(current.customers.churn_rate_by_revenue).toEqual({ available: true, value: 0.5 })
      await solo.query('ROLLBACK')
    } finally { await solo.end() }
  })

  describe('signup funnel', () => {
    /** Runs the seeding and the funnel inside one rolled-back transaction, so no signup outlives its test. */
    async function funnel(seed: (db: Pool, base: Pick<SignupInput, 'plan_revision_id'>) => Promise<void>) {
      const solo = new Pool({ connectionString: url, max: 1 })
      try {
        await solo.query('BEGIN')
        await seed(solo, { plan_revision_id: p1 })
        const rows = await signupFunnel(solo, period, now)
        await solo.query('ROLLBACK')
        expect(rows.map(row => row.selection)).toEqual(['both', 'crm', 'inbox'])
        return Object.fromEntries(rows.map(({ selection, ...counts }) => [selection, counts])) as Record<'both' | 'crm' | 'inbox', typeof zero>
      } finally { await solo.end() }
    }
    const zero = { registered: 0, started: 0, conversion_eligible: 0, converted: 0, renewal_eligible: 0, renewed: 0 }
    const creditNote = (db: Pool, where: string, params: unknown[], amount: string, reference: string) => db.query(`INSERT INTO invoice_adjustments(id,invoice_id,customer_id,kind,reason,amount_minor,currency,exponent,status,created_by,origin,cause,refund_reference,refunded_at,refunded_by)
      SELECT $1,i.id,i.customer_id,'credit_note','Fixture refund',${amount},'SAR',2,'refunded','vendor-test','vendor','vendor_refund','${reference}',now(),'vendor-test' FROM invoices i WHERE ${where}`, [randomUUID(), ...params])

    it('files a public signup under the apps it selected, and ignores one that selected none', async () => {
      const rows = await funnel(async (db, base) => {
        await seedSignup(db, { ...base, name: 'crm only', apps: { crm: true }, registered_at: '2026-10-02T09:00:00Z' })
        await seedSignup(db, { ...base, name: 'inbox only', apps: { inbox: true }, registered_at: '2026-10-02T09:00:00Z' })
        await seedSignup(db, { ...base, name: 'inbox two', apps: { inbox: true }, registered_at: '2026-10-03T09:00:00Z' })
        await seedSignup(db, { ...base, name: 'both', apps: { crm: true, inbox: true }, registered_at: '2026-10-04T09:00:00Z' })
        await seedSignup(db, { ...base, name: 'none', apps: {}, registered_at: '2026-10-04T09:00:00Z' })
      })
      expect(rows).toEqual({ crm: { ...zero, registered: 1 }, inbox: { ...zero, registered: 2 }, both: { ...zero, registered: 1 } })
    })

    it('counts a trial as started only once the first sign-in recorded its deadline', async () => {
      const rows = await funnel(async (db, base) => {
        await seedSignup(db, { ...base, name: 'signed in', apps: { crm: true }, registered_at: '2026-10-02T09:00:00Z', trial_ends_at: '2026-10-16T09:00:00Z' })
        await seedSignup(db, { ...base, name: 'never signed in', apps: { crm: true }, registered_at: '2026-10-02T09:00:00Z' })
      })
      expect(rows.crm).toEqual({ ...zero, registered: 2, started: 1 })
    })

    it('counts conversion only after the trial deadline plus seven days, and only when paid inside that window', async () => {
      const rows = await funnel(async (db, base) => {
        const trial = (name: string, trial_ends_at: string, first_paid_at?: string) =>
          seedSignup(db, { ...base, name, apps: { crm: true }, registered_at: '2026-10-01T09:00:00Z', trial_ends_at, first_paid_at })
        await trial('paid in window', '2026-10-02T09:00:00Z', '2026-10-06T09:00:00Z')
        await trial('paid at the edge', '2026-10-02T09:00:00Z', '2026-10-09T09:00:00Z')
        await trial('paid too late', '2026-10-02T09:00:00Z', '2026-10-12T09:00:00Z')
        await trial('never paid', '2026-10-02T09:00:00Z')
        await trial('window still open', '2026-10-12T09:00:00Z', '2026-10-13T09:00:00Z')
      })
      expect(rows.crm).toMatchObject({ registered: 5, started: 5, conversion_eligible: 4, converted: 2 })
    })

    it('does not count an AI top-up paid during the trial as the first paid conversion', async () => {
      const topup = (db: Pool, seeded: { customer_id: string, subscription_id: string }, paid_at: string) => seedInvoice(db, { ...seeded, status: 'paid', total_minor: 5000, issued_at: paid_at, due_at: paid_at, paid_at })
        .then(id => db.query(`INSERT INTO invoice_lines(id,invoice_id,position,key,kind,timing,description,quantity,unit_minor,amount_minor,currency,exponent,period_start,period_end,source_revision_id)
          VALUES($1,$2,0,'ai_topup','ai_topup','now','AI top-up',1,5000,5000,'SAR',2,$3,$3,$1)`, [randomUUID(), id, paid_at.slice(0, 10)]))
      const rows = await funnel(async (db, base) => {
        const trial = (name: string) => seedSignup(db, { ...base, name, apps: { crm: true }, registered_at: '2026-10-01T09:00:00Z', trial_ends_at: '2026-10-02T09:00:00Z' })
        await topup(db, await trial('only a top-up'), '2026-10-01T12:00:00Z')
        const both = await trial('top-up then plan')
        await topup(db, both, '2026-10-01T12:00:00Z')
        await seedInvoice(db, { ...both, status: 'paid', total_minor: 11500, issued_at: '2026-10-05T09:00:00Z', due_at: '2026-10-05T09:00:00Z', paid_at: '2026-10-05T09:00:00Z' })
      })
      expect(rows.crm).toMatchObject({ registered: 2, started: 2, conversion_eligible: 2, converted: 1 })
    })

    it('does not count a first invoice that was credited in full, but counts one credited in part', async () => {
      const rows = await funnel(async (db, base) => {
        const trial = (name: string) => seedSignup(db, { ...base, name, apps: { crm: true }, registered_at: '2026-10-01T09:00:00Z', trial_ends_at: '2026-10-02T09:00:00Z', first_paid_at: '2026-10-05T09:00:00Z' })
        await creditNote(db, 'i.subscription_id=$2', [(await trial('refunded in full')).subscription_id], '11500', 'MOY-FULL')
        await creditNote(db, 'i.subscription_id=$2', [(await trial('refunded in part')).subscription_id], '1500', 'MOY-PART')
      })
      expect(rows.crm).toMatchObject({ conversion_eligible: 2, converted: 1 })
    })

    it('makes the first renewal eligible after its due date plus the plan grace days, and renewed only when paid by then', async () => {
      const rows = await funnel(async (db, base) => {
        const renewal = (name: string, due_at: string, paid_at?: string) => seedSignup(db, { ...base, name, apps: { inbox: true }, registered_at: '2026-10-01T09:00:00Z',
          trial_ends_at: '2026-10-02T09:00:00Z', first_paid_at: '2026-10-03T09:00:00Z', renewal: { due_at, paid_at } })
        // The plan fixture grants five grace days, so a renewal due October 4 is measured from October 9.
        await renewal('paid inside grace', '2026-10-04T00:00:00Z', '2026-10-08T00:00:00Z')
        await renewal('paid after grace', '2026-10-04T00:00:00Z', '2026-10-10T00:00:00Z')
        await renewal('unpaid', '2026-10-04T00:00:00Z')
        await renewal('grace still running', '2026-10-12T00:00:00Z', '2026-10-13T00:00:00Z')
      })
      expect(rows.inbox).toMatchObject({ registered: 4, renewal_eligible: 3, renewed: 1 })
    })

    it('does not count a first renewal invoice that was credited in full as renewed', async () => {
      const rows = await funnel(async (db, base) => {
        const seeded = await seedSignup(db, { ...base, name: 'renewal refunded', apps: { crm: true, inbox: true }, registered_at: '2026-10-01T09:00:00Z',
          trial_ends_at: '2026-10-02T09:00:00Z', first_paid_at: '2026-10-03T09:00:00Z', renewal: { due_at: '2026-10-04T00:00:00Z', paid_at: '2026-10-05T00:00:00Z' } })
        await creditNote(db, "i.subscription_id=$2 AND i.paid_at='2026-10-05T00:00:00Z'", [seeded.subscription_id], 'i.total_minor', 'MOY-RENEWAL')
      })
      expect(rows.both).toMatchObject({ renewal_eligible: 1, renewed: 0 })
    })

    it('leaves out signups outside the period and trials that are not public first-login signups', async () => {
      const rows = await funnel(async (db, base) => {
        await seedSignup(db, { ...base, name: 'before the period', apps: { crm: true }, registered_at: '2026-09-20T09:00:00Z', trial_ends_at: '2026-09-21T09:00:00Z' })
        await seedSignup(db, { ...base, name: 'after now', apps: { crm: true }, registered_at: '2026-10-16T09:00:00Z' })
        await seedSignup(db, { ...base, name: 'vendor started', apps: { crm: true }, registered_at: '2026-10-02T09:00:00Z', trial_ends_at: '2026-10-03T09:00:00Z', requires_first_login: false })
        await seedSignup(db, { ...base, name: 'counted', apps: { crm: true }, registered_at: '2026-10-02T09:00:00Z' })
      })
      expect(rows.crm).toEqual({ ...zero, registered: 1 })
    })
  })
})
