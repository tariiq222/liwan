import { z } from 'zod'
import { InboxRefSchema, InboxTemplateCategorySchema } from './index'

// Wire shapes of /api/v1/inbox/reports: inbox analytics from WebVue's own daily aggregates, Meta's cost and volume
// per day, and Meta's template analytics. Every schema mirrors one serializer in
// odoo-addons/webvue_inbox/serializers/reports.py exactly (strict objects).

const Id = z.number().int().positive()
const Count = z.number().int().nonnegative()
const Seconds = z.number().nonnegative()
const Ratio = z.number().min(0).max(1)
const Amount = z.number().nonnegative()
const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
const UtcDateTime = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/)
const CurrencyCode = z.string().regex(/^[A-Z]{3}$/)
const CountryCode = z.string().regex(/^[A-Z]{2}$/)
const list = <T extends z.ZodType>(item: T) => z.object({
  items: z.array(item),
  total: Count,
}).strict()

export const INBOX_REPORTS_CAPABILITY = 'inbox.reports.read'
export const INBOX_REPORTS_FEATURE = 'inbox.reports'
// The longest range one request may ask for, in days (inclusive of both ends).
export const INBOX_REPORT_MAX_DAYS = 366
// Meta keeps template analytics for 90 days.
export const INBOX_TEMPLATE_ANALYTICS_MAX_DAYS = 90

const dayNumber = (date: string) => Date.parse(`${date}T00:00:00Z`) / 86_400_000
// Days covered by an inclusive range; 0 when `to` is before `from`.
export const inboxReportRangeDays = (from: string, to: string) => Math.max(0, dayNumber(to) - dayNumber(from) + 1)
const rangeWithin = (maximum: number) => (query: { from: string; to: string }) => {
  const days = inboxReportRangeDays(query.from, query.to)
  return days >= 1 && days <= maximum
}

// ---------------------------------------------------------------- queries

export const InboxReportGranularitySchema = z.enum(['day', 'week', 'month'])
export const InboxReportBreakdownBySchema = z.enum(['agent', 'department', 'channel'])

// The local days of the report timezone (the inbox working-hours timezone), both ends included.
export const InboxReportQuerySchema = z.object({
  from: IsoDate,
  to: IsoDate,
  channel_id: Id.optional(),
  department_id: Id.optional(),
  agent_id: Id.optional(),
}).strict().refine(rangeWithin(INBOX_REPORT_MAX_DAYS), {
  message: `the range runs forward and covers at most ${INBOX_REPORT_MAX_DAYS} days`, path: ['to'],
})

export const InboxReportBreakdownQuerySchema = z.object({
  by: InboxReportBreakdownBySchema,
  from: IsoDate,
  to: IsoDate,
  channel_id: Id.optional(),
  department_id: Id.optional(),
}).strict().refine(rangeWithin(INBOX_REPORT_MAX_DAYS), {
  message: `the range runs forward and covers at most ${INBOX_REPORT_MAX_DAYS} days`, path: ['to'],
})

// Meta's days are UTC days.
export const InboxCostQuerySchema = z.object({
  from: IsoDate,
  to: IsoDate,
  channel_id: Id.optional(),
}).strict().refine(rangeWithin(INBOX_REPORT_MAX_DAYS), {
  message: `the range runs forward and covers at most ${INBOX_REPORT_MAX_DAYS} days`, path: ['to'],
})

export const InboxTemplateAnalyticsQuerySchema = z.object({
  channel_id: Id,
  from: IsoDate,
  to: IsoDate,
}).strict().refine(rangeWithin(INBOX_TEMPLATE_ANALYTICS_MAX_DAYS), {
  message: `the range runs forward and covers at most ${INBOX_TEMPLATE_ANALYTICS_MAX_DAYS} days`, path: ['to'],
})

export const InboxTemplateAnalyticsDetailQuerySchema = z.object({
  from: IsoDate,
  to: IsoDate,
}).strict().refine(rangeWithin(INBOX_TEMPLATE_ANALYTICS_MAX_DAYS), {
  message: `the range runs forward and covers at most ${INBOX_TEMPLATE_ANALYTICS_MAX_DAYS} days`, path: ['to'],
})

// ---------------------------------------------------------------- inbox metrics (WebVue's own data)

// How long customers waited for the first agent reply of a conversation period.
export const InboxFirstResponseBucketsSchema = z.object({
  under_5m: Count,
  under_15m: Count,
  under_1h: Count,
  under_4h: Count,
  under_24h: Count,
  over_24h: Count,
}).strict()

export const InboxReportMetricsSchema = z.object({
  conversations_opened: Count,
  // Resolved by an agent or a rule; auto_closed are conversations the idle timer closed without a resolution.
  conversations_resolved: Count,
  conversations_auto_closed: Count,
  messages_in: Count,
  // Outbound written by agents (templates included); automated outbound is counted apart.
  messages_out: Count,
  messages_automated: Count,
  messages_failed: Count,
  templates_sent: Count,
  templates_failed: Count,
  // messages_automated / (messages_automated + messages_out); null without any outbound.
  automated_share: Ratio.nullable(),
  first_response: z.object({
    count: Count,
    average_seconds: Seconds.nullable(),
    buckets: InboxFirstResponseBucketsSchema,
  }).strict(),
  resolution: z.object({
    count: Count,
    average_seconds: Seconds.nullable(),
  }).strict(),
  csat: z.object({
    good: Count,
    neutral: Count,
    bad: Count,
    // good / (good + neutral + bad); null without answers.
    score: Ratio.nullable(),
  }).strict(),
}).strict()

// One bucket of the series; `start` is its first local day (a Monday for weeks, the 1st for months).
export const InboxReportPointSchema = z.object({
  start: IsoDate,
  messages_in: Count,
  messages_out: Count,
  messages_automated: Count,
  conversations_opened: Count,
  conversations_resolved: Count,
  first_response_average_seconds: Seconds.nullable(),
  resolution_average_seconds: Seconds.nullable(),
}).strict()

export const InboxReportOverviewSchema = z.object({
  from: IsoDate,
  to: IsoDate,
  granularity: InboxReportGranularitySchema,
  // The IANA zone whose local days the report counts.
  timezone: z.string().min(1).max(64),
  totals: InboxReportMetricsSchema,
  // The same metrics over the equally long period that ends the day before `from`.
  previous: InboxReportMetricsSchema,
  series: z.array(InboxReportPointSchema).max(INBOX_REPORT_MAX_DAYS),
  // When the newest aggregate row of the range was computed (rows are rebuilt hourly); null without rows.
  computed_at: UtcDateTime.nullable(),
}).strict()

// `subject` is the agent, department or channel; null is the unattributed row (automation, no department).
export const InboxReportBreakdownRowSchema = z.object({
  subject: InboxRefSchema.nullable(),
  metrics: InboxReportMetricsSchema,
}).strict()
export const InboxReportBreakdownSchema = list(InboxReportBreakdownRowSchema)

// ---------------------------------------------------------------- Meta cost and volume (pricing analytics)

export const InboxPricingCategorySchema = z.enum([
  'authentication', 'authentication_international', 'marketing', 'marketing_lite', 'service', 'utility',
  'referral_conversion', 'unknown',
])
export const InboxPricingTypeSchema = z.enum(['regular', 'free_customer_service', 'free_entry_point', 'unknown'])

// `cost` is null when Meta reports no cost (a Solution Partner credit line). Meta's figures are approximate.
export const InboxCostCategoryRowSchema = z.object({
  category: InboxPricingCategorySchema,
  type: InboxPricingTypeSchema,
  volume: Count,
  cost: Amount.nullable(),
}).strict()

export const InboxCostCountryRowSchema = z.object({
  country: CountryCode,
  volume: Count,
  cost: Amount.nullable(),
}).strict()

export const InboxCostPointSchema = z.object({
  start: IsoDate,
  volume: Count,
  paid_volume: Count,
  cost: Amount.nullable(),
}).strict()

export const InboxCostChannelSyncSchema = z.object({
  channel: InboxRefSchema,
  synced_at: UtcDateTime.nullable(),
  error: z.string().nullable(),
}).strict()

export const InboxCostReportSchema = z.object({
  from: IsoDate,
  to: IsoDate,
  granularity: InboxReportGranularitySchema,
  // The business account's billing currency; null when Meta does not report it.
  currency: CurrencyCode.nullable(),
  totals: z.object({
    volume: Count,
    paid_volume: Count,
    free_volume: Count,
    cost: Amount.nullable(),
  }).strict(),
  by_category: z.array(InboxCostCategoryRowSchema).max(32),
  // Largest volumes first.
  by_country: z.array(InboxCostCountryRowSchema).max(250),
  series: z.array(InboxCostPointSchema).max(INBOX_REPORT_MAX_DAYS),
  channels: z.array(InboxCostChannelSyncSchema),
}).strict()

// ---------------------------------------------------------------- template analytics (Meta)

export const InboxTemplateButtonClickTypeSchema = z.enum(['quick_reply', 'url', 'unknown'])

export const InboxTemplateAnalyticsTemplateSchema = z.object({
  id: Id,
  name: z.string(),
  language: z.string(),
  category: InboxTemplateCategorySchema,
}).strict()

// Meta's counts (sent, delivered, read, clicked, amount spent) beside WebVue's own sends and failures of the template.
export const InboxTemplateAnalyticsRowSchema = z.object({
  template: InboxTemplateAnalyticsTemplateSchema,
  sent: Count,
  delivered: Count,
  read: Count,
  clicked: Count,
  amount_spent: Amount.nullable(),
  webvue_sent: Count,
  webvue_failed: Count,
}).strict()
export const InboxTemplateAnalyticsListSchema = list(InboxTemplateAnalyticsRowSchema)

export const InboxTemplateAnalyticsPointSchema = z.object({
  start: IsoDate,
  sent: Count,
  delivered: Count,
  read: Count,
  clicked: Count,
}).strict()

export const InboxTemplateButtonClicksSchema = z.object({
  type: InboxTemplateButtonClickTypeSchema,
  text: z.string(),
  clicked: Count,
}).strict()

export const InboxTemplateAnalyticsDetailSchema = z.object({
  template: InboxTemplateAnalyticsTemplateSchema,
  from: IsoDate,
  to: IsoDate,
  totals: InboxTemplateAnalyticsRowSchema.omit({ template: true }),
  series: z.array(InboxTemplateAnalyticsPointSchema).max(INBOX_TEMPLATE_ANALYTICS_MAX_DAYS),
  buttons: z.array(InboxTemplateButtonClicksSchema).max(10),
}).strict()

export type InboxReportGranularity = z.infer<typeof InboxReportGranularitySchema>
export type InboxReportBreakdownBy = z.infer<typeof InboxReportBreakdownBySchema>
export type InboxReportQuery = z.infer<typeof InboxReportQuerySchema>
export type InboxReportBreakdownQuery = z.infer<typeof InboxReportBreakdownQuerySchema>
export type InboxCostQuery = z.infer<typeof InboxCostQuerySchema>
export type InboxTemplateAnalyticsQuery = z.infer<typeof InboxTemplateAnalyticsQuerySchema>
export type InboxTemplateAnalyticsDetailQuery = z.infer<typeof InboxTemplateAnalyticsDetailQuerySchema>
export type InboxFirstResponseBuckets = z.infer<typeof InboxFirstResponseBucketsSchema>
export type InboxReportMetrics = z.infer<typeof InboxReportMetricsSchema>
export type InboxReportPoint = z.infer<typeof InboxReportPointSchema>
export type InboxReportOverview = z.infer<typeof InboxReportOverviewSchema>
export type InboxReportBreakdownRow = z.infer<typeof InboxReportBreakdownRowSchema>
export type InboxReportBreakdown = z.infer<typeof InboxReportBreakdownSchema>
export type InboxPricingCategory = z.infer<typeof InboxPricingCategorySchema>
export type InboxPricingType = z.infer<typeof InboxPricingTypeSchema>
export type InboxCostCategoryRow = z.infer<typeof InboxCostCategoryRowSchema>
export type InboxCostCountryRow = z.infer<typeof InboxCostCountryRowSchema>
export type InboxCostPoint = z.infer<typeof InboxCostPointSchema>
export type InboxCostChannelSync = z.infer<typeof InboxCostChannelSyncSchema>
export type InboxCostReport = z.infer<typeof InboxCostReportSchema>
export type InboxTemplateButtonClickType = z.infer<typeof InboxTemplateButtonClickTypeSchema>
export type InboxTemplateAnalyticsTemplate = z.infer<typeof InboxTemplateAnalyticsTemplateSchema>
export type InboxTemplateAnalyticsRow = z.infer<typeof InboxTemplateAnalyticsRowSchema>
export type InboxTemplateAnalyticsList = z.infer<typeof InboxTemplateAnalyticsListSchema>
export type InboxTemplateAnalyticsPoint = z.infer<typeof InboxTemplateAnalyticsPointSchema>
export type InboxTemplateButtonClicks = z.infer<typeof InboxTemplateButtonClicksSchema>
export type InboxTemplateAnalyticsDetail = z.infer<typeof InboxTemplateAnalyticsDetailSchema>
