import { describe, expect, it } from 'vitest'
import type { InboxCostCategoryRow, InboxReportBreakdownRow, InboxReportMetrics } from '@webvue/contracts'
import { InboxReportMetricsSchema } from '@webvue/contracts'
import {
  answeredChart, changeOf, changeTone, costByCategoryChart, costTiles, csatChart, dailyCostChart, firstResponseChart, formatAmount, formatDuration, formatRatio,
  hasCostCategories, hasCsat, hasFirstResponses, overviewTiles, resolvedByChart, shareOf, volumeByTypeChart, volumeChart,
} from '../inboxReportCharts'

const UNITS = { day: 'd', hour: 'h', minute: 'm', second: 's' }
const t = (key: string, params?: Record<string, unknown>) => params ? `${key}:${JSON.stringify(params)}` : key

const metrics = (patch: Partial<InboxReportMetrics> = {}): InboxReportMetrics => InboxReportMetricsSchema.parse({
  conversations_opened: 10, conversations_resolved: 8, conversations_auto_closed: 1, messages_in: 40, messages_out: 30, messages_automated: 10, messages_failed: 0,
  templates_sent: 5, templates_failed: 0, automated_share: 0.25,
  first_response: { count: 6, average_seconds: 300, buckets: { under_5m: 3, under_15m: 2, under_1h: 1, under_4h: 0, under_24h: 0, over_24h: 0 } },
  resolution: { count: 8, average_seconds: 7200 }, csat: { good: 3, neutral: 1, bad: 0, score: 0.75 }, ...patch,
})

describe('formatters', () => {
  it('shows the two most significant units of a duration and a dash without data', () => {
    expect(formatDuration(null, UNITS, 'en')).toBe('—')
    expect(formatDuration(0, UNITS, 'en')).toBe('0 s')
    expect(formatDuration(45, UNITS, 'en')).toBe('45 s')
    expect(formatDuration(300, UNITS, 'en')).toBe('5 m')
    expect(formatDuration(3725, UNITS, 'en')).toBe('1 h 2 m')
    expect(formatDuration(90_000, UNITS, 'en')).toBe('1 d 1 h')
    expect(formatDuration(86_400 * 2 + 59, UNITS, 'en')).toBe('2 d')
  })

  it('formats ratios and amounts, with dashes for missing values', () => {
    expect(formatRatio(0.256, 'en')).toBe('25.6%')
    expect(formatRatio(null, 'en')).toBe('—')
    expect(formatAmount(12.5, 'USD', 'en')).toBe('$12.50')
    expect(formatAmount(12.5, null, 'en')).toBe('12.5')
    expect(formatAmount(null, 'USD', 'en')).toBe('—')
    expect(shareOf(1, 4)).toBe(0.25)
    expect(shareOf(1, 0)).toBeNull()
    expect(shareOf(9, 4)).toBe(1)
  })
})

describe('change against the previous period', () => {
  it('names the direction and the size, and handles a zero or missing previous value', () => {
    expect(changeOf(12, 10)).toEqual({ direction: 'up', ratio: 0.2 })
    expect(changeOf(5, 10)).toEqual({ direction: 'down', ratio: 0.5 })
    expect(changeOf(10, 10)?.direction).toBe('flat')
    expect(changeOf(3, 0)).toEqual({ direction: 'up', ratio: null })
    expect(changeOf(0, 0)?.direction).toBe('flat')
    expect(changeOf(null, 4)).toBeNull()
    expect(changeOf(4, null)).toBeNull()
  })

  it('gives a tone only for a clear move the good or the bad way', () => {
    expect(changeTone(changeOf(12, 10), true)).toBe('success')
    expect(changeTone(changeOf(12, 10), false)).toBe('danger')
    expect(changeTone(changeOf(8, 10), false)).toBe('success')
    expect(changeTone(changeOf(10.5, 10), true)).toBeUndefined()
    expect(changeTone(changeOf(10, 10), true)).toBeUndefined()
    expect(changeTone(null, true)).toBeUndefined()
  })
})

describe('KPI tiles', () => {
  it('builds the eight overview tiles with their change hints', () => {
    const tiles = overviewTiles(metrics(), metrics({ conversations_opened: 5 }), t, 'en', '/inbox/reports/templates')
    expect(tiles.map(tile => tile.id)).toEqual(['opened', 'resolved', 'first-response', 'resolution', 'csat', 'automated', 'messages', 'template-failures'])
    expect(tiles[0]).toMatchObject({ value: '10', hint: 'inbox.reports.change.up:{"value":"100%"}' })
    expect(tiles[2]).toMatchObject({ value: '5 inbox.reports.units.minute', hint: 'inbox.reports.change.flat' })
    expect(tiles[4]).toMatchObject({ value: '75%', progress: 75 })
    expect(tiles[6]!.value).toBe('40 / 30')
    expect(tiles[7]).toMatchObject({ value: '0', to: '/inbox/reports/templates' })
    expect(tiles[7]!.tone).toBeUndefined()
  })

  it('marks template failures as danger and leaves CSAT without a bar when nobody answered', () => {
    const tiles = overviewTiles(metrics({ templates_failed: 3, csat: { good: 0, neutral: 0, bad: 0, score: null } }), metrics(), t, 'en')
    expect(tiles[7]).toMatchObject({ tone: 'danger', value: '3' })
    expect(tiles[7]).not.toHaveProperty('to')
    expect(tiles[4]!.value).toBe('—')
    expect(tiles[4]).not.toHaveProperty('progress')
  })

  it('builds the cost tiles, with the marketing share of the total', () => {
    const rows: InboxCostCategoryRow[] = [
      { category: 'marketing', type: 'regular', volume: 10, cost: 3 }, { category: 'utility', type: 'regular', volume: 10, cost: 1 }, { category: 'service', type: 'free_customer_service', volume: 20, cost: 0 },
    ]
    const tiles = costTiles({ from: '2026-10-01', to: '2026-10-02', granularity: 'day', currency: 'USD', totals: { volume: 40, paid_volume: 20, free_volume: 20, cost: 4 }, by_category: rows, by_country: [], series: [], channels: [] }, t, 'en')
    expect(tiles.map(tile => tile.value)).toEqual(['$4.00', '20', '20', '75%'])
  })
})

describe('chart mappers', () => {
  it('maps the series to grouped columns labelled by bucket start', () => {
    const point = { start: '2026-10-05', messages_in: 4, messages_out: 3, messages_automated: 1, conversations_opened: 0, conversations_resolved: 0, first_response_average_seconds: null, resolution_average_seconds: null }
    const chart = volumeChart([point, { ...point, start: '2026-10-06' }], 'day', { messagesIn: 'in', messagesOut: 'out', automated: 'auto' })
    expect(chart).toMatchObject({ kind: 'bar', orientation: 'vertical', palette: 'status' })
    expect(chart.series.map(series => series.key)).toEqual(['in', 'out', 'automated'])
    expect(chart.data.map(datum => datum.name)).toEqual(['05/10', '06/10'])
    expect(chart.data[0]!.values).toEqual({ in: 4, out: 3, automated: 1 })
    expect(volumeChart([{ ...point, start: '2026-10-01' }], 'month', { messagesIn: '', messagesOut: '', automated: '' }).data[0]!.name).toBe('10/2026')
  })

  it('maps the six first-response buckets with warm tones for slow answers', () => {
    const buckets = metrics().first_response.buckets
    const chart = firstResponseChart(buckets, bucket => bucket, 'n')
    expect(chart.data.map(datum => datum.name)).toEqual(['under_5m', 'under_15m', 'under_1h', 'under_4h', 'under_24h', 'over_24h'])
    expect(chart.data.map(datum => datum.values.count)).toEqual([3, 2, 1, 0, 0, 0])
    expect(chart.data.at(-1)!.tone).toBe('danger')
    expect(hasFirstResponses(buckets)).toBe(true)
    expect(hasFirstResponses({ under_5m: 0, under_15m: 0, under_1h: 0, under_4h: 0, under_24h: 0, over_24h: 0 })).toBe(false)
  })

  it('maps satisfaction to a toned donut centred on the score', () => {
    const chart = csatChart(metrics().csat, { good: 'g', neutral: 'n', bad: 'b', centerSub: 's' }, 'en')
    expect(chart).toMatchObject({ kind: 'donut', total: 4, centerLabel: '75%', centerSubLabel: 's' })
    expect(chart.data.map(datum => datum.tone)).toEqual(['success', 'warning', 'danger'])
    expect(hasCsat({ good: 0, neutral: 0, bad: 0, score: null })).toBe(false)
  })

  it('splits outbound messages between agents and automation', () => {
    const chart = answeredChart({ messages_out: 30, messages_automated: 10 }, { agents: 'a', automated: 'b', centerSub: 'c' }, 'en')
    expect(chart.data.map(datum => datum.value)).toEqual([30, 10])
    expect(chart.centerLabel).toBe('40')
  })

  it('lists resolved conversations per subject, hides zero rows and names the unattributed one', () => {
    const row = (id: number | null, resolved: number): InboxReportBreakdownRow => ({ subject: id ? { id, name: `d${id}` } : null, metrics: metrics({ conversations_resolved: resolved }) })
    const chart = resolvedByChart([row(1, 8), row(null, 3), row(2, 0)], 'resolved', 'none')
    expect(chart).toMatchObject({ orientation: 'horizontal', maxValue: 8 })
    expect(chart.data.map(datum => datum.name)).toEqual(['d1', 'none'])
    expect(resolvedByChart([], 'r', 'n').maxValue).toBe(1)
  })

  it('maps Meta cost to daily columns, a category donut of paid categories and a volume-by-type bar', () => {
    const daily = dailyCostChart([{ start: '2026-10-01', volume: 5, paid_volume: 5, cost: 1.5 }, { start: '2026-10-02', volume: 5, paid_volume: 0, cost: null }], 'cost')
    expect(daily.data.map(datum => datum.values.cost)).toEqual([1.5, null])
    const rows: InboxCostCategoryRow[] = [
      { category: 'marketing', type: 'regular', volume: 10, cost: 3.456 }, { category: 'marketing', type: 'regular', volume: 5, cost: 1 },
      { category: 'service', type: 'free_customer_service', volume: 20, cost: 0 }, { category: 'utility', type: 'regular', volume: 7, cost: null },
    ]
    const donut = costByCategoryChart(rows, category => category, 'sub', 'USD', 'en')
    expect(donut.data).toEqual([{ name: 'marketing', value: 4.46 }])
    expect(hasCostCategories(rows)).toBe(true)
    expect(hasCostCategories([{ category: 'utility', type: 'regular', volume: 7, cost: null }])).toBe(false)
    const bars = volumeByTypeChart(rows, type => type, 'v')
    expect(bars.data.map(datum => [datum.name, datum.values.volume])).toEqual([['regular', 22], ['free_customer_service', 20]])
  })
})
