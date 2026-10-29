import { describe, expect, it } from 'vitest'
import {
  InboxBusinessProfilePatchSchema,
  InboxDisplayNameRequestSchema,
  InboxPinSchema,
  InboxProfilePictureUploadSchema,
} from '../index'
import {
  InboxCostQuerySchema,
  InboxReportBreakdownQuerySchema,
  InboxReportMetricsSchema,
  InboxReportOverviewSchema,
  InboxReportQuerySchema,
  InboxTemplateAnalyticsDetailQuerySchema,
  InboxTemplateAnalyticsQuerySchema,
  inboxReportRangeDays,
} from '../reports'

const day = (offset: number) => new Date(Date.UTC(2026, 0, 1 + offset)).toISOString().slice(0, 10)
const range = (days: number) => ({ from: day(0), to: day(days - 1) })

const METRICS = {
  conversations_opened: 0,
  conversations_resolved: 0,
  conversations_auto_closed: 0,
  messages_in: 0,
  messages_out: 0,
  messages_automated: 0,
  messages_failed: 0,
  templates_sent: 0,
  templates_failed: 0,
  automated_share: null,
  first_response: {
    count: 0,
    average_seconds: null,
    buckets: { under_5m: 0, under_15m: 0, under_1h: 0, under_4h: 0, under_24h: 0, over_24h: 0 },
  },
  resolution: { count: 0, average_seconds: null },
  csat: { good: 0, neutral: 0, bad: 0, score: null },
}

describe('report query ranges', () => {
  it('counts both ends of the range', () => {
    expect(inboxReportRangeDays(day(0), day(0))).toBe(1)
    expect(inboxReportRangeDays(day(0), day(365))).toBe(366)
    expect(inboxReportRangeDays(day(5), day(0))).toBe(0)
  })

  it('accepts 1 and 366 days and refuses 367 and reversed ranges', () => {
    const cases = [
      [InboxReportQuerySchema, {}],
      [InboxReportBreakdownQuerySchema, { by: 'agent' }],
      [InboxCostQuerySchema, {}],
    ] as const
    for (const [schema, extra] of cases) {
      expect(schema.safeParse({ ...range(1), ...extra }).success).toBe(true)
      expect(schema.safeParse({ ...range(366), ...extra }).success).toBe(true)
      expect(schema.safeParse({ ...range(367), ...extra }).success).toBe(false)
      expect(schema.safeParse({ from: day(3), to: day(0), ...extra }).success).toBe(false)
    }
  })

  it('limits template analytics to 90 days', () => {
    expect(InboxTemplateAnalyticsQuerySchema.safeParse({ channel_id: 1, ...range(90) }).success).toBe(true)
    expect(InboxTemplateAnalyticsQuerySchema.safeParse({ channel_id: 1, ...range(91) }).success).toBe(false)
    expect(InboxTemplateAnalyticsDetailQuerySchema.safeParse(range(90)).success).toBe(true)
    expect(InboxTemplateAnalyticsDetailQuerySchema.safeParse(range(91)).success).toBe(false)
    expect(InboxTemplateAnalyticsQuerySchema.safeParse(range(30)).success).toBe(false)
  })

  it('is strict about unknown keys and bad dates', () => {
    expect(InboxReportQuerySchema.safeParse({ ...range(7), extra: 1 }).success).toBe(false)
    expect(InboxReportQuerySchema.safeParse({ from: '2026-1-1', to: '2026-01-02' }).success).toBe(false)
    expect(InboxReportBreakdownQuerySchema.safeParse({ ...range(7), by: 'tag' }).success).toBe(false)
  })
})

describe('report metrics', () => {
  it('allows null averages and scores for an empty period', () => {
    expect(InboxReportMetricsSchema.safeParse(METRICS).success).toBe(true)
  })

  it('refuses a ratio above one, a negative count and unknown keys', () => {
    expect(InboxReportMetricsSchema.safeParse({ ...METRICS, automated_share: 1.5 }).success).toBe(false)
    expect(InboxReportMetricsSchema.safeParse({ ...METRICS, messages_in: -1 }).success).toBe(false)
    expect(InboxReportMetricsSchema.safeParse({ ...METRICS, extra: 1 }).success).toBe(false)
  })

  it('parses an overview', () => {
    const overview = {
      from: day(0), to: day(6), granularity: 'day', timezone: 'Asia/Riyadh', totals: METRICS, previous: METRICS,
      series: [], computed_at: null,
    }
    expect(InboxReportOverviewSchema.safeParse(overview).success).toBe(true)
    expect(InboxReportOverviewSchema.safeParse({ ...overview, granularity: 'year' }).success).toBe(false)
  })
})

describe('number administration bodies', () => {
  it('takes only a six digit PIN', () => {
    for (const pin of ['123456', '000000']) expect(InboxPinSchema.safeParse({ pin }).success).toBe(true)
    for (const pin of ['12345', '1234567', 'abcdef', '12 456']) expect(InboxPinSchema.safeParse({ pin }).success).toBe(false)
    expect(InboxPinSchema.safeParse({ pin: 123456 }).success).toBe(false)
    expect(InboxPinSchema.safeParse({ pin: '123456', extra: 1 }).success).toBe(false)
  })

  it('applies Meta\'s profile limits at the edges', () => {
    const ok = (body: object) => InboxBusinessProfilePatchSchema.safeParse(body).success
    expect(ok({ about: 'x'.repeat(139) })).toBe(true)
    expect(ok({ about: 'x'.repeat(140) })).toBe(false)
    expect(ok({ about: '' })).toBe(false)
    expect(ok({ address: 'x'.repeat(256) })).toBe(true)
    expect(ok({ address: 'x'.repeat(257) })).toBe(false)
    expect(ok({ address: '' })).toBe(true)
    expect(ok({ description: 'x'.repeat(512) })).toBe(true)
    expect(ok({ description: 'x'.repeat(513) })).toBe(false)
    expect(ok({ email: '' })).toBe(true)
    expect(ok({ email: 'a@acme.test' })).toBe(true)
    expect(ok({ email: 'nope' })).toBe(false)
    expect(ok({ email: `${'a'.repeat(120)}@acme.test` })).toBe(false)
    expect(ok({ websites: ['https://a.test', 'http://b.test'] })).toBe(true)
    expect(ok({ websites: ['https://a.test', 'https://b.test', 'https://c.test'] })).toBe(false)
    expect(ok({ websites: ['ftp://a.test'] })).toBe(false)
    expect(ok({ websites: [`https://${'a'.repeat(250)}`] })).toBe(false)
    expect(ok({ vertical: 'retail' })).toBe(true)
    expect(ok({ vertical: null })).toBe(true)
    expect(ok({ vertical: 'RETAIL' })).toBe(false)
    expect(ok({ unknown: 1 })).toBe(false)
  })

  it('checks the picture type and size', () => {
    const picture = (body: object) => InboxProfilePictureUploadSchema.safeParse({ name: 'a.png', mimetype: 'image/png', data: 'QQ==', ...body }).success
    expect(picture({})).toBe(true)
    expect(picture({ mimetype: 'image/jpeg' })).toBe(true)
    expect(picture({ mimetype: 'image/gif' })).toBe(false)
    expect(picture({ data: '' })).toBe(false)
    expect(picture({ data: 'A'.repeat(Math.ceil((5 * 1024 * 1024) / 3) * 4) })).toBe(true)
    expect(picture({ data: 'A'.repeat(Math.ceil((5 * 1024 * 1024) / 3) * 4 + 1) })).toBe(false)
  })

  it('keeps the display name between 3 and 128 characters', () => {
    const ok = (name: string) => InboxDisplayNameRequestSchema.safeParse({ name }).success
    expect([ok('ab'), ok('abc'), ok('x'.repeat(128)), ok('x'.repeat(129)), ok('  ab  ')]).toEqual([false, true, true, false, false])
  })
})
