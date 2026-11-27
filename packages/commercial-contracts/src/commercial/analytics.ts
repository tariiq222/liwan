import { z } from 'zod'
import { moneySchema } from './schemas.js'

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)

/** Longest period the vendor analytics endpoint answers (two years of days). */
export const ANALYTICS_MAX_DAYS = 731

export const analyticsQuerySchema = z.strictObject({ from: isoDate, to: isoDate }).refine(
  q => q.from <= q.to && (Date.parse(q.to) - Date.parse(q.from)) / 86_400_000 < ANALYTICS_MAX_DAYS,
  { path: ['to'], message: 'Period must be ordered and at most two years' },
)

/**
 * `no_cancellation_date`: the control plane stores no time for a subscription leaving service.
 * `history_not_recorded`: a past figure that a subscription which has since left service would change.
 * `no_data`: the denominator is empty.
 */
export const analyticsUnavailableReasonSchema = z.enum(['no_data', 'no_cancellation_date', 'history_not_recorded'])

function figure<T extends z.ZodType>(value: T) {
  return z.union([
    z.strictObject({ available: z.literal(true), value }),
    z.strictObject({ available: z.literal(false), reason: analyticsUnavailableReasonSchema }),
  ])
}
const count = z.number().int().min(0)
const ratio = z.number().min(0).max(1)
const money = figure(moneySchema)

/** Every period figure; the endpoint returns it for the requested period and for the period before it. */
export const analyticsFiguresSchema = z.strictObject({
  revenue: z.strictObject({
    mrr: money, arr: money,
    new_mrr: money, expansion_mrr: money, contraction_mrr: money, churned_mrr: money,
    arpc: money, extra_branch_mrr: money,
  }),
  collection: z.strictObject({
    collected: money, outstanding: money,
    overdue_0_30: money, overdue_31_60: money, overdue_61_plus: money,
    payment_success_rate: figure(ratio), avg_days_to_pay: figure(z.number().min(0)),
  }),
  customers: z.strictObject({
    active: figure(count), new: figure(count), churned: figure(count),
    churn_rate_by_count: figure(ratio), churn_rate_by_revenue: figure(ratio), trial_conversion_rate: figure(ratio),
    trial_outcomes: z.strictObject({ converted: count, kept_subset: count, free_base: count }).optional(),
  }),
  operations: z.strictObject({ avg_hours_to_ready: figure(z.number().min(0)) }),
})

const usageRowSchema = z.strictObject({
  customer_id: z.string(), customer_name: z.string(), metric: z.string(),
  used: z.number().min(0), limit: z.number().min(0), ratio: z.number().min(0),
})

/** What is true now; these cannot be restated for a past period, so they carry no comparison. */
export const analyticsSnapshotSchema = z.strictObject({
  states: z.array(z.strictObject({ state: z.string(), count })),
  plans: z.array(z.strictObject({ plan_id: z.string(), name: z.string(), customers: count, mrr: moneySchema })),
  plan_changes: z.array(z.strictObject({
    from_plan: z.string(), to_plan: z.string(), direction: z.enum(['upgrade', 'downgrade', 'lateral']), count,
  })),
  upsell: z.array(usageRowSchema),
  low_usage: z.array(usageRowSchema),
  /** Billable customers with a workspace and limits whose usage could not be read; they are missing from `upsell` and `low_usage`. */
  usage_unavailable: count,
  renewals: z.array(z.strictObject({ within_days: z.union([z.literal(30), z.literal(60), z.literal(90)]), count, value: moneySchema })),
  stalled_fulfillments: z.strictObject({
    count,
    items: z.array(z.strictObject({
      order_id: z.string(), customer_id: z.string(), customer_name: z.string(),
      fulfillment_state: z.string(), age_hours: z.number().min(0),
    })),
  }),
})

/** Strictly rising by code unit, so unique and sorted; the control plane returns apps in this order (`COLLATE "C"`). */
const strictlyAscending = (values: readonly string[]) => values.every((value, index) => index === 0 || values[index - 1]! < value)

/**
 * One selection observed in the period: the apps a signup's bundles enabled, or the base plan alone (`base`, no apps).
 * `selection` is the apps joined with `+`, so it carries no bound of its own. No app may be named `base`: that name
 * is reserved for the base plan, which the rows are told apart by.
 */
export const signupFunnelRowSchema = z.strictObject({
  selection: z.string(),
  apps: z.array(z.string().regex(/^[a-z][a-z0-9_]*$/).max(64)),
  registered: count, started: count, conversion_eligible: count, converted: count,
  renewal_eligible: count, renewed: count,
}).refine(
  row => row.apps.length === 0 ? row.selection === 'base'
    : strictlyAscending(row.apps) && !row.apps.includes('base') && row.selection === row.apps.join('+'),
  { path: ['selection'], message: 'Selection is base for no apps, or the ascending, unique apps, none named base, joined with +' },
)

export const analyticsSchema = z.strictObject({
  period: z.strictObject({ from: isoDate, to: isoDate }),
  previous_period: z.strictObject({ from: isoDate, to: isoDate }),
  /** All amounts are in this currency; subscriptions billed in another one are counted in `excluded_subscriptions`. */
  currency: z.string().regex(/^[A-Z]{3}$/),
  exponent: z.number().int().min(0).max(4),
  excluded_subscriptions: count,
  generated_at: z.string(),
  current: analyticsFiguresSchema,
  previous: analyticsFiguresSchema,
  /** Months whose book cannot be restated honestly carry unavailable figures. */
  trend: z.array(z.strictObject({ month: z.string().regex(/^\d{4}-\d{2}$/), mrr: money, customers: figure(count) })),
  signup_funnel: z.array(signupFunnelRowSchema),
  snapshot: analyticsSnapshotSchema,
})

export type AnalyticsQuery = z.infer<typeof analyticsQuerySchema>
export type AnalyticsFigures = z.infer<typeof analyticsFiguresSchema>
export type AnalyticsSnapshot = z.infer<typeof analyticsSnapshotSchema>
export type SignupFunnelRow = z.infer<typeof signupFunnelRowSchema>
export type Analytics = z.infer<typeof analyticsSchema>
export type AnalyticsFigure<T> = { available: true, value: T } | { available: false, reason: z.infer<typeof analyticsUnavailableReasonSchema> }
