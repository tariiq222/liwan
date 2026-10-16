import { ANALYTICS_MAX_DAYS, type AnalyticsFigure, type AnalyticsFigures, type Money } from '@nasq/commercial-contracts'
import { formatCommercialMoney } from '@nasq/commercial-ui/app/utils/commercial'

export const PERIOD_PRESETS = ['month', 'quarter', 'year', 'custom'] as const
export type PeriodPreset = (typeof PERIOD_PRESETS)[number]
export interface PeriodChoice { preset: PeriodPreset, from: string, to: string }

const DAY_MS = 86_400_000
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/
const isDay = (value: unknown): value is string => typeof value === 'string' && ISO_DAY.test(value) && !Number.isNaN(Date.parse(value))

/** The range a preset stands for on `today` (UTC): from the start of the month, quarter or year up to today. */
export function presetRange(preset: Exclude<PeriodPreset, 'custom'>, today: string): { from: string, to: string } {
  const [year, month] = [Number(today.slice(0, 4)), Number(today.slice(5, 7))]
  const firstMonth = preset === 'month' ? month : preset === 'quarter' ? month - ((month - 1) % 3) : 1
  return { from: `${year}-${String(firstMonth).padStart(2, '0')}-01`, to: today }
}

/** The period the URL asks for; anything missing or invalid falls back to this month. */
export function periodFromQuery(query: Record<string, unknown>, today: string): PeriodChoice {
  const preset = PERIOD_PRESETS.find(candidate => candidate === query.period) ?? 'month'
  if (preset === 'custom' && isDay(query.from) && isDay(query.to) && query.from <= query.to && customRangeFits(query.from, query.to)) return { preset, from: query.from, to: query.to }
  const range = presetRange(preset === 'custom' ? 'month' : preset, today)
  return { preset: preset === 'custom' ? 'month' : preset, ...range }
}

export const customRangeFits = (from: string, to: string): boolean => (Date.parse(to) - Date.parse(from)) / DAY_MS < ANALYTICS_MAX_DAYS

export type FigureFormat = 'money' | 'percent' | 'count' | 'days' | 'hours'
/** `up`: a rise is good news; `down`: a rise is bad news (outstanding, overdue); `neutral`: no judgement. */
export type Direction = 'up' | 'down' | 'neutral'

/** The number behind a figure, null when it is unavailable. Money counts in minor units. */
export function figureNumber(figure: AnalyticsFigure<number | Money>): number | null {
  if (!figure.available) return null
  return typeof figure.value === 'number' ? figure.value : figure.value.minor
}

export function formatFigure(figure: AnalyticsFigure<number | Money>, format: FigureFormat, locale: string): string | null {
  if (!figure.available) return null
  const intl = locale.startsWith('ar') ? 'ar-SA-u-nu-latn' : 'en-US'
  if (typeof figure.value !== 'number') return formatCommercialMoney(figure.value, locale)
  if (format === 'percent') return new Intl.NumberFormat(intl, { style: 'percent', maximumFractionDigits: 1 }).format(figure.value)
  return new Intl.NumberFormat(intl, { maximumFractionDigits: format === 'count' ? 0 : 1 }).format(figure.value)
}

export interface Delta { change: 'up' | 'down' | 'flat', percent: number | null }

/** Change against the previous period; `percent` is null when there was nothing to compare against. Null when either side is unavailable. */
export function deltaOf(current: number | null, previous: number | null): Delta | null {
  if (current === null || previous === null) return null
  const change = current > previous ? 'up' : current < previous ? 'down' : 'flat'
  return { change, percent: previous === 0 ? null : Math.abs(current - previous) / previous }
}

/** Whether a change helps (`good`), hurts (`bad`) or is just a change, given what a rise means for the figure. */
export function deltaTone(change: Delta['change'], direction: Direction): 'good' | 'bad' | 'neutral' {
  if (change === 'flat' || direction === 'neutral') return 'neutral'
  return (change === 'up') === (direction === 'up') ? 'good' : 'bad'
}

export interface CsvRow { section: string, metric: string, current: string, previous: string }

const csvCell = (value: string) => (/[",\n\r]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value)

/** Semicolon-free comma CSV with a byte-order mark so spreadsheets open Arabic text correctly. */
export function toCsv(header: readonly string[], rows: readonly CsvRow[]): string {
  const lines = [header, ...rows.map(row => [row.section, row.metric, row.current, row.previous])]
  return `﻿${lines.map(line => line.map(csvCell).join(',')).join('\r\n')}\r\n`
}

export type KpiGroup = 'revenue' | 'collection' | 'customers' | 'operations'
export interface KpiSpec {
  id: string
  group: KpiGroup
  icon: `i-lucide-${string}`
  format: FigureFormat
  direction: Direction
  pick: (figures: AnalyticsFigures) => AnalyticsFigure<number | Money>
}

/** Every comparable figure, in display order; the page and the CSV export both read this list. */
export const KPIS: readonly KpiSpec[] = [
  { id: 'mrr', group: 'revenue', icon: 'i-lucide-repeat', format: 'money', direction: 'up', pick: f => f.revenue.mrr },
  { id: 'arr', group: 'revenue', icon: 'i-lucide-calendar-range', format: 'money', direction: 'up', pick: f => f.revenue.arr },
  { id: 'newMrr', group: 'revenue', icon: 'i-lucide-circle-plus', format: 'money', direction: 'up', pick: f => f.revenue.new_mrr },
  { id: 'expansionMrr', group: 'revenue', icon: 'i-lucide-trending-up', format: 'money', direction: 'up', pick: f => f.revenue.expansion_mrr },
  { id: 'contractionMrr', group: 'revenue', icon: 'i-lucide-trending-down', format: 'money', direction: 'down', pick: f => f.revenue.contraction_mrr },
  { id: 'churnedMrr', group: 'revenue', icon: 'i-lucide-circle-minus', format: 'money', direction: 'down', pick: f => f.revenue.churned_mrr },
  { id: 'arpc', group: 'revenue', icon: 'i-lucide-user-round', format: 'money', direction: 'up', pick: f => f.revenue.arpc },
  { id: 'extraBranchMrr', group: 'revenue', icon: 'i-lucide-git-branch-plus', format: 'money', direction: 'up', pick: f => f.revenue.extra_branch_mrr },
  { id: 'collected', group: 'collection', icon: 'i-lucide-hand-coins', format: 'money', direction: 'up', pick: f => f.collection.collected },
  { id: 'outstanding', group: 'collection', icon: 'i-lucide-hourglass', format: 'money', direction: 'down', pick: f => f.collection.outstanding },
  { id: 'overdue0to30', group: 'collection', icon: 'i-lucide-alarm-clock', format: 'money', direction: 'down', pick: f => f.collection.overdue_0_30 },
  { id: 'overdue31to60', group: 'collection', icon: 'i-lucide-alarm-clock', format: 'money', direction: 'down', pick: f => f.collection.overdue_31_60 },
  { id: 'overdue61plus', group: 'collection', icon: 'i-lucide-alarm-clock', format: 'money', direction: 'down', pick: f => f.collection.overdue_61_plus },
  { id: 'paymentSuccessRate', group: 'collection', icon: 'i-lucide-credit-card', format: 'percent', direction: 'up', pick: f => f.collection.payment_success_rate },
  { id: 'avgDaysToPay', group: 'collection', icon: 'i-lucide-timer', format: 'days', direction: 'down', pick: f => f.collection.avg_days_to_pay },
  { id: 'activeCustomers', group: 'customers', icon: 'i-lucide-users', format: 'count', direction: 'up', pick: f => f.customers.active },
  { id: 'newCustomers', group: 'customers', icon: 'i-lucide-user-plus', format: 'count', direction: 'up', pick: f => f.customers.new },
  { id: 'churnedCustomers', group: 'customers', icon: 'i-lucide-user-minus', format: 'count', direction: 'down', pick: f => f.customers.churned },
  { id: 'churnRateByCount', group: 'customers', icon: 'i-lucide-percent', format: 'percent', direction: 'down', pick: f => f.customers.churn_rate_by_count },
  { id: 'churnRateByRevenue', group: 'customers', icon: 'i-lucide-percent', format: 'percent', direction: 'down', pick: f => f.customers.churn_rate_by_revenue },
  { id: 'trialConversion', group: 'customers', icon: 'i-lucide-badge-check', format: 'percent', direction: 'up', pick: f => f.customers.trial_conversion_rate },
  { id: 'hoursToReady', group: 'operations', icon: 'i-lucide-rocket', format: 'hours', direction: 'down', pick: f => f.operations.avg_hours_to_ready },
]

/** The headline figures at the top of the page. */
export const HEADLINE_IDS: readonly string[] = ['mrr', 'arr', 'collected', 'activeCustomers']
