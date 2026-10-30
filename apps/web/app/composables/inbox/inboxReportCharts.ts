import type {
  InboxCostCategoryRow, InboxCostPoint, InboxCostReport, InboxFirstResponseBuckets, InboxPricingType, InboxReportBreakdownRow, InboxReportGranularity,
  InboxReportMetrics, InboxReportPoint, InboxTemplateAnalyticsPoint,
} from '@liwan/contracts'
import type { KpiTile, KpiTone } from '@liwan/ui/app/utils/kpiTile'
import type { ReportBarChart as DashboardBarChart, ReportBarDatum as DashboardBarDatum, ReportDatum as ChartDatum, ReportDonutChart as DashboardDonutChart } from './inboxChartTypes'

// Pure mappers from the report wire shapes to the existing DashboardChart kinds (donut and bar) and the KPI strip. They
// stay direction-free: the chart itself mirrors itself for right-to-left. Nothing here reads the route or the clock.

type Translate = (key: string, params?: Record<string, unknown>) => string
const DASH = '—'

// ---------------------------------------------------------------- formatters

export interface DurationUnits { day: string; hour: string; minute: string; second: string }

/** The two most significant units of a duration ("2 h 5 m"); null (no data) is a dash. */
export function formatDuration(seconds: number | null, units: DurationUnits, locale?: string): string {
  if (seconds === null) return DASH
  const number = new Intl.NumberFormat(locale)
  const total = Math.round(seconds)
  const parts: Array<[number, string]> = [[Math.floor(total / 86_400), units.day], [Math.floor((total % 86_400) / 3_600), units.hour], [Math.floor((total % 3_600) / 60), units.minute], [total % 60, units.second]]
  const first = parts.findIndex(([value]) => value > 0)
  if (first < 0) return `${number.format(0)} ${units.second}`
  const text = parts.slice(first, first + 2).filter(([value]) => value > 0).map(([value, unit]) => `${number.format(value)} ${unit}`).join(' ')
  // The strip sets its figures left-to-right; an Arabic duration is isolated right-to-left so "2 س 5 د" keeps its order.
  return locale?.startsWith('ar') ? `\u2067${text}\u2069` : text
}

/** A 0..1 ratio as a percentage with at most one decimal; null is a dash. */
export function formatRatio(ratio: number | null, locale?: string): string {
  return ratio === null ? DASH : new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 1 }).format(ratio)
}

/** A Meta amount: in the billing currency when known, else as a plain number. Meta reports no cost on some accounts (null). */
export function formatAmount(value: number | null, currency: string | null, locale?: string): string {
  if (value === null) return DASH
  return new Intl.NumberFormat(locale, currency ? { style: 'currency', currency } : { maximumFractionDigits: 2 }).format(value)
}

// ---------------------------------------------------------------- change against the previous period

export interface Change {
  direction: 'up' | 'down' | 'flat'
  /** Relative change; null when the previous value was zero (no ratio exists). */
  ratio: number | null
}

/** How `current` moved from `previous`; null when either side has no value to compare. */
export function changeOf(current: number | null, previous: number | null): Change | null {
  if (current === null || previous === null) return null
  if (previous === 0) return current === 0 ? { direction: 'flat', ratio: 0 } : { direction: 'up', ratio: null }
  const ratio = (current - previous) / previous
  if (Math.abs(ratio) < 0.005) return { direction: 'flat', ratio: 0 }
  return { direction: ratio > 0 ? 'up' : 'down', ratio: Math.abs(ratio) }
}

const CLEAR_CHANGE = 0.1

/** A tone only when the metric moved clearly (10% or more) the good or the bad way. */
export function changeTone(change: Change | null, higherIsBetter: boolean): KpiTone | undefined {
  if (!change || change.direction === 'flat') return undefined
  if (change.ratio !== null && change.ratio < CLEAR_CHANGE) return undefined
  return (change.direction === 'up') === higherIsBetter ? 'success' : 'danger'
}

function changeHint(change: Change | null, t: Translate, locale?: string): string {
  if (!change) return t('inbox.reports.change.none')
  if (change.direction === 'flat') return t('inbox.reports.change.flat')
  if (change.ratio === null) return t('inbox.reports.change.new')
  const value = new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 0 }).format(change.ratio)
  return t(`inbox.reports.change.${change.direction}`, { value })
}

// ---------------------------------------------------------------- KPI strip

export function durationUnits(t: Translate): DurationUnits {
  return { day: t('inbox.reports.units.day'), hour: t('inbox.reports.units.hour'), minute: t('inbox.reports.units.minute'), second: t('inbox.reports.units.second') }
}

/** The eight tiles of the overview, each with its change against the previous period. */
export function overviewTiles(totals: InboxReportMetrics, previous: InboxReportMetrics, t: Translate, locale?: string, templatesTo?: string): KpiTile[] {
  const count = new Intl.NumberFormat(locale)
  const units = durationUnits(t)
  const hint = (current: number | null, before: number | null) => changeHint(changeOf(current, before), t, locale)
  const tone = (current: number | null, before: number | null, higherIsBetter: boolean) => changeTone(changeOf(current, before), higherIsBetter)
  const failures = totals.templates_failed
  return [
    { id: 'opened', icon: 'i-lucide-message-circle-plus', label: t('inbox.reports.kpi.opened'), value: count.format(totals.conversations_opened), hint: hint(totals.conversations_opened, previous.conversations_opened) },
    { id: 'resolved', icon: 'i-lucide-circle-check', label: t('inbox.reports.kpi.resolved'), value: count.format(totals.conversations_resolved), hint: hint(totals.conversations_resolved, previous.conversations_resolved), tone: tone(totals.conversations_resolved, previous.conversations_resolved, true) },
    { id: 'first-response', icon: 'i-lucide-timer', label: t('inbox.reports.kpi.firstResponse'), value: formatDuration(totals.first_response.average_seconds, units, locale), hint: hint(totals.first_response.average_seconds, previous.first_response.average_seconds), tone: tone(totals.first_response.average_seconds, previous.first_response.average_seconds, false) },
    { id: 'resolution', icon: 'i-lucide-hourglass', label: t('inbox.reports.kpi.resolution'), value: formatDuration(totals.resolution.average_seconds, units, locale), hint: hint(totals.resolution.average_seconds, previous.resolution.average_seconds), tone: tone(totals.resolution.average_seconds, previous.resolution.average_seconds, false) },
    {
      id: 'csat', icon: 'i-lucide-smile', label: t('inbox.reports.kpi.csat'), value: formatRatio(totals.csat.score, locale),
      hint: hint(totals.csat.score, previous.csat.score), tone: tone(totals.csat.score, previous.csat.score, true),
      ...(totals.csat.score === null ? {} : { progress: Math.round(totals.csat.score * 100) }),
    },
    { id: 'automated', icon: 'i-lucide-bot', label: t('inbox.reports.kpi.automated'), value: formatRatio(totals.automated_share, locale), hint: hint(totals.automated_share, previous.automated_share) },
    {
      id: 'messages', icon: 'i-lucide-messages-square', label: t('inbox.reports.kpi.messages'),
      value: `${count.format(totals.messages_in)} / ${count.format(totals.messages_out)}`,
      hint: hint(totals.messages_in + totals.messages_out, previous.messages_in + previous.messages_out),
    },
    {
      id: 'template-failures', icon: 'i-lucide-triangle-alert', label: t('inbox.reports.kpi.templateFailures'), value: count.format(failures),
      hint: hint(failures, previous.templates_failed), ...(failures > 0 ? { tone: 'danger' as const } : {}), ...(templatesTo ? { to: templatesTo } : {}),
    },
  ]
}

// ---------------------------------------------------------------- overview charts

function bucketLabel(start: string, granularity: InboxReportGranularity): string {
  const [year, month, day] = start.split('-')
  return granularity === 'month' ? `${month}/${year}` : `${day}/${month}`
}

export interface VolumeLabels { messagesIn: string; messagesOut: string; automated: string }

/** Grouped columns per bucket: customer messages, agent replies and automated replies. */
export function volumeChart(series: readonly InboxReportPoint[], granularity: InboxReportGranularity, labels: VolumeLabels): DashboardBarChart {
  return {
    kind: 'bar', orientation: 'vertical', palette: 'status',
    series: [{ key: 'in', label: labels.messagesIn }, { key: 'out', label: labels.messagesOut }, { key: 'automated', label: labels.automated }],
    data: series.map((point): DashboardBarDatum => ({
      name: bucketLabel(point.start, granularity),
      values: { in: point.messages_in, out: point.messages_out, automated: point.messages_automated },
    })),
  }
}

export const hasVolume = (series: readonly InboxReportPoint[]) => series.some(point => point.messages_in + point.messages_out + point.messages_automated > 0)

const BUCKETS = ['under_5m', 'under_15m', 'under_1h', 'under_4h', 'under_24h', 'over_24h'] as const
const BUCKET_TONE = { under_5m: 'success', under_15m: 'success', under_1h: 'info', under_4h: 'warning', under_24h: 'warning', over_24h: 'danger' } as const

/** The six waiting-time buckets of the first agent reply, the slow ones in warm tones. */
export function firstResponseChart(buckets: InboxFirstResponseBuckets, bucketLabelOf: (bucket: (typeof BUCKETS)[number]) => string, seriesLabel: string): DashboardBarChart {
  return {
    kind: 'bar', orientation: 'vertical', palette: 'primary', series: [{ key: 'count', label: seriesLabel }],
    data: BUCKETS.map((bucket): DashboardBarDatum => ({ name: bucketLabelOf(bucket), tone: BUCKET_TONE[bucket], values: { count: buckets[bucket] } })),
  }
}

export const hasFirstResponses = (buckets: InboxFirstResponseBuckets) => BUCKETS.some(bucket => buckets[bucket] > 0)

export interface CsatLabels { good: string; neutral: string; bad: string; centerSub: string }

/** Good, neutral and bad answers as a donut; the centre is the share of good answers. */
export function csatChart(csat: InboxReportMetrics['csat'], labels: CsatLabels, locale?: string): DashboardDonutChart {
  const data: ChartDatum[] = [
    { name: labels.good, value: csat.good, tone: 'success' },
    { name: labels.neutral, value: csat.neutral, tone: 'warning' },
    { name: labels.bad, value: csat.bad, tone: 'danger' },
  ]
  return { kind: 'donut', palette: 'status', data, total: csat.good + csat.neutral + csat.bad, centerLabel: formatRatio(csat.score, locale), centerSubLabel: labels.centerSub }
}

export const hasCsat = (csat: InboxReportMetrics['csat']) => csat.good + csat.neutral + csat.bad > 0

/** Who sent the outbound messages: agents or automation. */
export function answeredChart(totals: Pick<InboxReportMetrics, 'messages_out' | 'messages_automated'>, labels: { agents: string; automated: string; centerSub: string }, locale?: string): DashboardDonutChart {
  const total = totals.messages_out + totals.messages_automated
  return {
    kind: 'donut', palette: 'status', total, centerLabel: new Intl.NumberFormat(locale).format(total), centerSubLabel: labels.centerSub,
    data: [{ name: labels.agents, value: totals.messages_out, tone: 'primary' }, { name: labels.automated, value: totals.messages_automated, tone: 'neutral' }],
  }
}

export const hasAnswered = (totals: Pick<InboxReportMetrics, 'messages_out' | 'messages_automated'>) => totals.messages_out + totals.messages_automated > 0

/** The value axis of a horizontal bar chart needs its upper end: the largest bar, at least 1. */
const axisMax = (values: readonly number[]) => Math.max(1, ...values)

/** Conversations resolved per department (or any breakdown), the largest first; the unattributed row gets `unassigned`. */
export function resolvedByChart(rows: readonly InboxReportBreakdownRow[], seriesLabel: string, unassigned: string): DashboardBarChart {
  const shown = rows.filter(row => row.metrics.conversations_resolved > 0)
  return {
    kind: 'bar', orientation: 'horizontal', palette: 'primary', series: [{ key: 'resolved', label: seriesLabel }],
    maxValue: axisMax(shown.map(row => row.metrics.conversations_resolved)),
    data: shown.map((row): DashboardBarDatum => ({ name: row.subject?.name ?? unassigned, values: { resolved: row.metrics.conversations_resolved } })),
  }
}

export const hasResolved = (rows: readonly InboxReportBreakdownRow[]) => rows.some(row => row.metrics.conversations_resolved > 0)

// ---------------------------------------------------------------- Meta cost charts

/** Cost per day; a day without a reported cost is an empty column. */
export function dailyCostChart(series: readonly InboxCostPoint[], seriesLabel: string): DashboardBarChart {
  return {
    kind: 'bar', orientation: 'vertical', palette: 'primary', series: [{ key: 'cost', label: seriesLabel }],
    data: series.map((point): DashboardBarDatum => ({ name: bucketLabel(point.start, 'day'), values: { cost: point.cost } })),
  }
}

export const hasCostSeries = (series: readonly InboxCostPoint[]) => series.some(point => (point.cost ?? 0) > 0)

/** Cost per pricing category; paid categories only, summed over the pricing types. */
export function costByCategoryChart(rows: readonly InboxCostCategoryRow[], categoryLabel: (category: InboxCostCategoryRow['category']) => string, centerSub: string, currency: string | null, locale?: string): DashboardDonutChart {
  const sums = new Map<InboxCostCategoryRow['category'], number>()
  for (const row of rows) if ((row.cost ?? 0) > 0) sums.set(row.category, (sums.get(row.category) ?? 0) + (row.cost ?? 0))
  const total = [...sums.values()].reduce((sum, value) => sum + value, 0)
  return {
    kind: 'donut', palette: 'status', total, centerLabel: formatAmount(total, currency, locale), centerSubLabel: centerSub,
    data: [...sums].map(([category, value]): ChartDatum => ({ name: categoryLabel(category), value: Math.round(value * 100) / 100 })),
  }
}

export const hasCostCategories = (rows: readonly InboxCostCategoryRow[]) => rows.some(row => (row.cost ?? 0) > 0)

/** Message volume per pricing type (regular, free service window, free entry point). */
export function volumeByTypeChart(rows: readonly InboxCostCategoryRow[], typeLabel: (type: InboxPricingType) => string, seriesLabel: string): DashboardBarChart {
  const sums = new Map<InboxPricingType, number>()
  for (const row of rows) sums.set(row.type, (sums.get(row.type) ?? 0) + row.volume)
  const entries = [...sums].filter(([, volume]) => volume > 0).sort((a, b) => b[1] - a[1])
  return {
    kind: 'bar', orientation: 'horizontal', palette: 'primary', series: [{ key: 'volume', label: seriesLabel }],
    maxValue: axisMax(entries.map(([, volume]) => volume)),
    data: entries.map(([type, volume]): DashboardBarDatum => ({ name: typeLabel(type), values: { volume } })),
  }
}

export const hasVolumeByType = (rows: readonly InboxCostCategoryRow[]) => rows.some(row => row.volume > 0)

/** The four tiles of the cost page. Meta's amounts are approximate; the total says so. */
export function costTiles(report: InboxCostReport, t: Translate, locale?: string): KpiTile[] {
  const count = new Intl.NumberFormat(locale)
  const total = report.totals.cost
  const marketing = report.by_category.filter(row => row.category === 'marketing' || row.category === 'marketing_lite').reduce((sum, row) => sum + (row.cost ?? 0), 0)
  return [
    { id: 'cost', icon: 'i-lucide-wallet', label: t('inbox.reports.costs.kpi.total'), value: formatAmount(total, report.currency, locale), hint: t('inbox.reports.costs.kpi.totalHint') },
    { id: 'paid', icon: 'i-lucide-credit-card', label: t('inbox.reports.costs.kpi.paid'), value: count.format(report.totals.paid_volume) },
    { id: 'free', icon: 'i-lucide-gift', label: t('inbox.reports.costs.kpi.free'), value: count.format(report.totals.free_volume), hint: t('inbox.reports.costs.kpi.freeHint') },
    { id: 'marketing', icon: 'i-lucide-megaphone', label: t('inbox.reports.costs.kpi.marketing'), value: formatRatio(total && total > 0 ? Math.min(1, marketing / total) : null, locale), hint: t('inbox.reports.costs.kpi.marketingHint') },
  ]
}

// ---------------------------------------------------------------- template analytics

export interface TemplateSeriesLabels { sent: string; delivered: string; read: string; clicked: string }

export function templateSeriesChart(series: readonly InboxTemplateAnalyticsPoint[], labels: TemplateSeriesLabels): DashboardBarChart {
  return {
    kind: 'bar', orientation: 'vertical', palette: 'status',
    series: [{ key: 'sent', label: labels.sent }, { key: 'delivered', label: labels.delivered }, { key: 'read', label: labels.read }, { key: 'clicked', label: labels.clicked }],
    data: series.map((point): DashboardBarDatum => ({ name: bucketLabel(point.start, 'day'), values: { sent: point.sent, delivered: point.delivered, read: point.read, clicked: point.clicked } })),
  }
}

export const hasTemplateSeries = (series: readonly InboxTemplateAnalyticsPoint[]) => series.some(point => point.sent + point.delivered + point.read + point.clicked > 0)

/** A count as a share of another (0..1); null when there is nothing to divide by. */
export function shareOf(part: number, whole: number): number | null {
  return whole > 0 ? Math.min(1, part / whole) : null
}
