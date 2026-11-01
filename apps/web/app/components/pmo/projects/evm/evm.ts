// Presentation of earned value indices. Pure, see __tests__/evm.test.ts.
import type { ProjectEvm } from '@liwan/contracts'
import type { DashboardLineChart } from '@/utils/projectChartData'
import type { StateTone } from '@/composables/taskState'

export type IndexTone = 'neutral' | 'success' | 'warning' | 'danger'

/** CPI and SPI bands: below 0.9 is a problem, 0.9 to just under 1 needs attention, 1 or more is on plan; null says nothing. */
export function indexTone(value: number | null): IndexTone {
  if (value === null) return 'neutral'
  if (value < 0.9) return 'danger'
  return value < 1 ? 'warning' : 'success'
}

const BADGE_TONE: Record<IndexTone, StateTone> = { neutral: 'neutral', success: 'success', warning: 'warning', danger: 'destructive' }
export const indexBadgeTone = (value: number | null): StateTone => BADGE_TONE[indexTone(value)]

/** An index with two decimals, or the "not enough data" label when its divisor was not positive. */
export function formatIndex(value: number | null, unknown: string, locale = 'en'): string {
  return value === null ? unknown : new Intl.NumberFormat(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value)
}

/** Whole days since the epoch for an ISO calendar date, so the time axis is linear and free of time zones. */
export const dayNumber = (date: string): number => Math.round(Date.parse(`${date}T00:00:00Z`) / 86_400_000)

/**
 * The planned value curve as a line chart with today's earned value and actual cost as markers. Today is clamped into the
 * plotted span so the marks stay in view. `money` formats an amount for the legend.
 */
export function evmLineChart(evm: ProjectEvm, labels: { pv: string; ev: string; ac: string }, money: (value: number) => string): DashboardLineChart | null {
  const points = evm.planned_curve.map(point => ({ x: dayNumber(point.date), y: point.pv }))
  if (!points.length || evm.pv === null || evm.ev === null) return null
  const today = Math.min(Math.max(dayNumber(evm.as_of), points[0]!.x), points.at(-1)!.x)
  return {
    kind: 'line',
    series: { key: 'pv', label: labels.pv },
    seriesDisplay: money(evm.pv),
    data: points,
    markers: [
      { key: 'ev', label: labels.ev, display: money(evm.ev), x: today, y: evm.ev, tone: 'success' },
      { key: 'ac', label: labels.ac, display: money(evm.ac), x: today, y: evm.ac, tone: 'warning' },
    ],
  }
}
