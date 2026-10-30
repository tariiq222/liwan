import type { Pool } from 'pg'
import {
  analyticsQuerySchema, analyticsSchema, type Analytics, type AnalyticsFigure, type AnalyticsFigures, type AnalyticsSnapshot, type Cadence,
} from '@liwan/commercial-contracts'
import {
  bookInHistory, DAY_MS, inForceAt, monthEnds, movementIn, periodBounds, previousPeriod, ratio, recurringOf, riyadhDay, settleTrials, toTimelines,
  type AppliedOrder, type BookAt, type Period, type PricingBaseline, type Timelines,
} from './analytics-model.js'
import { CommercialHttpError } from './lifecycle.js'
import { usageOf, type SnapshotRow } from './usage.js'

const FALLBACK_CURRENCY = { currency: 'SAR', exponent: 2 }
const TREND_MONTHS = 12
const NEAR_LIMIT_RATIO = 0.8
const LOW_USAGE_RATIO = 0.2
const LIST_LIMIT = 10
/** A queued or applying fulfillment older than this is reported as stalled. */
const STALLED_AFTER_MS = 60 * 60 * 1000
const BILLABLE_STATES = ['active', 'past_due']
/** States of a subscription that has left service; the schema keeps no time for when it did. */
const DEPARTED_STATES = ['suspended', 'cancelled']
const RENEWAL_WINDOWS = [30, 60, 90] as const

type Ask = Pick<Pool, 'query'>
interface Live { subscription_id: string, customer_id: string, customer_name: string, tenant_id: string | null, renewal_at: string | null }
interface Book { timelines: Timelines, departed: Set<string>, currency: string, exponent: number, excluded: number }

const available = <T>(value: T): AnalyticsFigure<T> => ({ available: true, value })
const unavailable = (reason: 'no_data' | 'no_cancellation_date' | 'history_not_recorded'): AnalyticsFigure<never> => ({ available: false, reason })
const orNoData = (value: number | null): AnalyticsFigure<number> => (value === null ? unavailable('no_data') : available(value))
const num = (value: unknown): number => Number(value ?? 0)

async function liveSubscriptions(db: Ask): Promise<Live[]> {
  const rows = (await db.query(
    `SELECT s.id AS subscription_id, s.customer_id, c.name AS customer_name, s.tenant_id, s.renewal_at::text AS renewal_at
       FROM subscriptions s JOIN customers c ON c.id = s.customer_id WHERE s.state = ANY($1)`, [BILLABLE_STATES])).rows
  return rows
}

/** Every applied order of every subscription, whatever its state today, priced from its revision. Orders in other currencies than the book's are dropped and counted. */
async function loadBook(db: Ask): Promise<Book> {
  const rows = (await db.query(
    `SELECT o.subscription_id, s.state, s.trial_ends_at, o.currency, o.exponent, COALESCE(fe.applied_at, o.effective_at, o.created_at) AS applied_at,
            r.snapshot->'pricing' AS pricing, r.snapshot->'cadence' AS cadence, p.plan_id, p.name AS plan_name
       FROM orders o
       JOIN subscriptions s ON s.id = o.subscription_id
       JOIN subscription_revisions r ON r.id = o.target_revision_id
       JOIN plan_revisions p ON p.id = (r.snapshot->>'plan_revision_id')::uuid
       LEFT JOIN fulfillment_effects fe ON fe.order_id = o.id
      WHERE o.fulfillment_state = 'applied' AND NOT o.cancelled AND r.snapshot->'pricing' IS NOT NULL
      ORDER BY o.subscription_id, r.revision`)).rows
  const tally = new Map<string, { n: number, exponent: number }>()
  for (const row of rows) tally.set(row.currency, { n: (tally.get(row.currency)?.n ?? 0) + 1, exponent: row.exponent })
  const [currency, { exponent }] = [...tally.entries()].sort((a, b) => b[1].n - a[1].n || a[0].localeCompare(b[0]))[0]
    ?? [FALLBACK_CURRENCY.currency, { exponent: FALLBACK_CURRENCY.exponent }]
  const kept = rows.filter(row => row.currency === currency)
  const orders = kept.map((row): AppliedOrder => ({
    subscription_id: row.subscription_id, applied_at: new Date(row.applied_at).getTime(), plan_id: row.plan_id, plan_name: row.plan_name,
    ...recurringOf(row.pricing as PricingBaseline, row.cadence as Cadence),
  }))
  const trialEnds = new Map<string, number>(kept.filter(row => row.trial_ends_at).map(row => [row.subscription_id, new Date(row.trial_ends_at).getTime()]))
  const departed = new Set<string>(kept.filter(row => DEPARTED_STATES.includes(row.state)).map(row => row.subscription_id))
  const excluded = new Set(rows.filter(row => row.currency !== currency).map(row => row.subscription_id)).size
  return { timelines: settleTrials(toTimelines(orders), trialEnds), departed, currency, exponent, excluded }
}

interface Money { currency: string, exponent: number }
const money = (unit: Money, minor: number) => ({ currency: unit.currency, exponent: unit.exponent, minor })
const moneyFigure = (unit: Money, minor: number) => available(money(unit, Math.max(0, Math.round(minor))))

async function collection(db: Ask, unit: Money, period: Period) {
  const { start, end } = periodBounds(period)
  const from = new Date(start), to = new Date(end)
  const flow = (await db.query(
    `SELECT COALESCE(SUM(subtotal_minor) FILTER (WHERE status = 'paid' AND paid_at >= $1 AND paid_at < $2), 0) AS collected,
            AVG(EXTRACT(EPOCH FROM paid_at - issued_at)) FILTER (WHERE status = 'paid' AND paid_at >= $1 AND paid_at < $2 AND issued_at IS NOT NULL AND paid_at >= issued_at) AS pay_seconds
       FROM invoices WHERE currency = $3`, [from, to, unit.currency])).rows[0]
  const open = (await db.query(
    `SELECT COALESCE(SUM(subtotal_minor), 0) AS outstanding,
            COALESCE(SUM(subtotal_minor) FILTER (WHERE due_at < $1 AND $1 - due_at <= interval '30 days'), 0) AS late_30,
            COALESCE(SUM(subtotal_minor) FILTER (WHERE $1 - due_at > interval '30 days' AND $1 - due_at <= interval '60 days'), 0) AS late_60,
            COALESCE(SUM(subtotal_minor) FILTER (WHERE $1 - due_at > interval '60 days'), 0) AS late_over
       FROM invoices
      WHERE currency = $2 AND issued_at < $1 AND status IN ('issued', 'paid') AND (paid_at IS NULL OR paid_at >= $1)`, [to, unit.currency])).rows[0]
  const attempts = (await db.query(
    `SELECT count(*) FILTER (WHERE status = 'succeeded') AS ok, count(*) FILTER (WHERE status = 'failed') AS bad
       FROM payment_attempts WHERE currency = $3 AND created_at >= $1 AND created_at < $2`, [from, to, unit.currency])).rows[0]
  return {
    collected: moneyFigure(unit, num(flow.collected)),
    outstanding: moneyFigure(unit, num(open.outstanding)),
    overdue_0_30: moneyFigure(unit, num(open.late_30)),
    overdue_31_60: moneyFigure(unit, num(open.late_60)),
    overdue_61_plus: moneyFigure(unit, num(open.late_over)),
    payment_success_rate: orNoData(ratio(num(attempts.ok), num(attempts.ok) + num(attempts.bad))),
    avg_days_to_pay: orNoData(flow.pay_seconds === null ? null : num(flow.pay_seconds) / 86_400),
  }
}

async function trialConversion(db: Ask, period: Period, now: Date): Promise<AnalyticsFigure<number>> {
  const { start, end } = periodBounds(period)
  const row = (await db.query(
    `SELECT count(*) AS ended,
            count(*) FILTER (WHERE EXISTS (SELECT 1 FROM invoices i WHERE i.subscription_id = s.id AND i.status = 'paid'
                                              AND i.subtotal_minor > 0 AND i.paid_at >= s.trial_ends_at)) AS converted
       FROM subscriptions s WHERE s.trial_ends_at >= $1 AND s.trial_ends_at < LEAST($2::timestamptz, $3::timestamptz)`,
    [new Date(start), new Date(end), now])).rows[0]
  return orNoData(ratio(num(row.converted), num(row.ended)))
}

async function hoursToReady(db: Ask, period: Period): Promise<AnalyticsFigure<number>> {
  const { start, end } = periodBounds(period)
  const row = (await db.query(
    `SELECT AVG(EXTRACT(EPOCH FROM fe.applied_at - i.paid_at)) AS seconds
       FROM orders o JOIN fulfillment_effects fe ON fe.order_id = o.id JOIN invoices i ON i.order_id = o.id
      WHERE o.kind = 'new' AND o.fulfillment_state = 'applied' AND NOT o.cancelled AND i.status = 'paid'
        AND i.paid_at <= fe.applied_at AND fe.applied_at >= $1 AND fe.applied_at < $2`, [new Date(start), new Date(end)])).rows[0]
  return orNoData(row.seconds === null ? null : num(row.seconds) / 3600)
}

const historyLost = unavailable('history_not_recorded')

async function figuresFor(db: Ask, book: Book, unit: Money, period: Period, now: Date): Promise<AnalyticsFigures> {
  const { start, end } = periodBounds(period)
  const stock = bookInHistory(book.timelines, book.departed, end, now.getTime())
  const movement = movementIn(book.timelines, start, end)
  const lost = unavailable('no_cancellation_date')
  const stockMoney = (pick: (at: BookAt) => number) => (stock ? moneyFigure(unit, pick(stock)) : historyLost)
  return {
    revenue: {
      mrr: stockMoney(at => at.mrr_minor), arr: stockMoney(at => at.arr_minor),
      new_mrr: moneyFigure(unit, movement.new_minor), expansion_mrr: moneyFigure(unit, movement.expansion_minor),
      contraction_mrr: moneyFigure(unit, movement.contraction_minor), churned_mrr: lost,
      arpc: !stock ? historyLost : stock.customers > 0 ? moneyFigure(unit, stock.mrr_minor / stock.customers) : unavailable('no_data'),
      extra_branch_mrr: stockMoney(at => at.branch_mrr_minor),
    },
    collection: await collection(db, unit, period),
    customers: {
      active: stock ? available(stock.customers) : historyLost, new: available(movement.new_customers), churned: lost,
      churn_rate_by_count: lost, churn_rate_by_revenue: lost, trial_conversion_rate: await trialConversion(db, period, now),
    },
    operations: { avg_hours_to_ready: await hoursToReady(db, period) },
  }
}

interface UsageRow { customer_id: string, customer_name: string, metric: string, used: number, limit: number, ratio: number }
interface Usage { rows: UsageRow[], unavailable: number }

/** For each billable customer with a workspace, its most used limit; reads the latest usage snapshots (one query) against the applied limits. Customers whose usage cannot be read are counted. */
async function usageRows(db: Ask, live: readonly Live[], timelines: Timelines, now: Date): Promise<Usage> {
  const withTenant = live.filter(sub => sub.tenant_id && timelines.has(sub.subscription_id))
  if (!withTenant.length) return { rows: [], unavailable: 0 }
  const featureRows = (await db.query(
    `SELECT s.id, r.snapshot->'entitlement'->'features' AS features
       FROM subscriptions s JOIN subscription_revisions r ON r.id = s.applied_revision_id WHERE s.id = ANY($1)`, [withTenant.map(sub => sub.subscription_id)])).rows
  const features = new Map<string, Record<string, unknown>>(featureRows.map(row => [row.id, row.features ?? {}]))
  const snapshots = new Map<string, SnapshotRow>((await db.query(
    `SELECT DISTINCT ON (tenant_id) tenant_id, observed_at, metrics, freshness FROM usage_snapshots
      WHERE tenant_id = ANY($1) ORDER BY tenant_id, observed_at DESC, id DESC`, [withTenant.map(sub => sub.tenant_id)])).rows.map(row => [row.tenant_id, row]))
  const result: Usage = { rows: [], unavailable: 0 }
  for (const sub of withTenant) {
    const limits = Object.fromEntries(Object.entries(features.get(sub.subscription_id) ?? {}).filter((entry): entry is [string, number] => typeof entry[1] === 'number'))
    if (!Object.keys(limits).length) continue
    const usage = usageOf(snapshots.get(sub.tenant_id!), limits, now)
    const measured = usage.metrics.filter(metric => metric.used !== null && metric.limit !== null && metric.limit > 0)
    const top = measured.map(metric => ({ metric: metric.key, used: metric.used!, limit: metric.limit!, ratio: metric.used! / metric.limit! }))
      .sort((a, b) => b.ratio - a.ratio)[0]
    if (usage.freshness === 'unavailable') result.unavailable += 1
    else if (top) result.rows.push({ customer_id: sub.customer_id, customer_name: sub.customer_name, ...top })
  }
  return result
}

async function stalledFulfillments(db: Ask, now: Date): Promise<AnalyticsSnapshot['stalled_fulfillments']> {
  const rows = (await db.query(
    `SELECT o.id AS order_id, o.customer_id, c.name AS customer_name, o.fulfillment_state, o.created_at
       FROM orders o JOIN customers c ON c.id = o.customer_id
      WHERE NOT o.cancelled AND o.payment_state IN ('paid', 'not_required')
        AND (o.fulfillment_state IN ('failed', 'needs_intervention') OR (o.fulfillment_state IN ('queued', 'applying') AND o.created_at < $1))
      ORDER BY o.created_at`, [new Date(now.getTime() - STALLED_AFTER_MS)])).rows
  return {
    count: rows.length,
    items: rows.slice(0, LIST_LIMIT).map(row => ({
      order_id: row.order_id, customer_id: row.customer_id, customer_name: row.customer_name, fulfillment_state: row.fulfillment_state,
      age_hours: Math.max(0, (now.getTime() - new Date(row.created_at).getTime()) / 3_600_000),
    })),
  }
}

async function snapshotOf(db: Pool, live: readonly Live[], book: Book, unit: Money, current: Period, now: Date): Promise<AnalyticsSnapshot> {
  const nowMs = now.getTime()
  const { timelines } = book
  const present = bookInHistory(timelines, book.departed, nowMs + 1, nowMs)!
  const states = (await db.query('SELECT state, count(*) AS count FROM subscriptions GROUP BY state ORDER BY state')).rows
  const { start, end } = periodBounds(current)
  const usage = await usageRows(db, live, timelines, now)
  const byRatio = (a: UsageRow, b: UsageRow) => b.ratio - a.ratio
  const today = riyadhDay(nowMs)
  const renewals = RENEWAL_WINDOWS.map(days => {
    const limit = new Date(Date.parse(today) + days * DAY_MS).toISOString().slice(0, 10)
    const due = live.filter(sub => sub.renewal_at !== null && sub.renewal_at >= today && sub.renewal_at <= limit)
    const value = due.reduce((sum, sub) => sum + (inForceAt(timelines.get(sub.subscription_id) ?? [], nowMs + 1)?.cycle_minor ?? 0), 0)
    return { within_days: days, count: due.length, value: money(unit, value) }
  })
  return {
    states: states.map(row => ({ state: row.state, count: num(row.count) })),
    plans: [...present.plans.entries()].map(([plan_id, plan]) => ({ plan_id, name: plan.name, customers: plan.customers, mrr: money(unit, plan.mrr_minor) }))
      .sort((a, b) => b.mrr.minor - a.mrr.minor),
    plan_changes: movementIn(timelines, start, end).plan_changes,
    usage_unavailable: usage.unavailable,
    upsell: usage.rows.filter(row => row.ratio >= NEAR_LIMIT_RATIO).sort(byRatio).slice(0, LIST_LIMIT),
    low_usage: usage.rows.filter(row => row.ratio < LOW_USAGE_RATIO).sort((a, b) => a.ratio - b.ratio).slice(0, LIST_LIMIT),
    renewals,
    stalled_fulfillments: await stalledFulfillments(db, now),
  }
}

/** The vendor analytics: figures for `period` and the period before it, a 12-month MRR trend, and the present state of risks and opportunities. */
export async function getAnalytics(pool: Pool, period: Period, now: Date = new Date()): Promise<Analytics> {
  const live = await liveSubscriptions(pool)
  const book = await loadBook(pool)
  const unit = { currency: book.currency, exponent: book.exponent }
  const trend = monthEnds(period.to, TREND_MONTHS).map(({ month, end }) => {
    const at = bookInHistory(book.timelines, book.departed, end, now.getTime())
    return at
      ? { month, mrr: moneyFigure(unit, at.mrr_minor), customers: available(at.customers) }
      : { month, mrr: historyLost, customers: historyLost }
  })
  const previous = previousPeriod(period)
  return analyticsSchema.parse({
    period, previous_period: previous, currency: book.currency, exponent: book.exponent, excluded_subscriptions: book.excluded,
    generated_at: now.toISOString(),
    current: await figuresFor(pool, book, unit, period, now),
    previous: await figuresFor(pool, book, unit, previous, now),
    trend,
    snapshot: await snapshotOf(pool, live, book, unit, period, now),
  })
}

/** GET /v1/commercial/analytics?from=YYYY-MM-DD&to=YYYY-MM-DD */
export async function analyticsFromQuery(pool: Pool, url: URL): Promise<Analytics> {
  const parsed = analyticsQuerySchema.safeParse({ from: url.searchParams.get('from') ?? '', to: url.searchParams.get('to') ?? '' })
  if (!parsed.success) throw new CommercialHttpError('invalid', 422, parsed.error.issues[0]?.path.join('.') || 'to')
  return getAnalytics(pool, parsed.data)
}
