// Presentation of earned value indices. Pure, see __tests__/evm.test.ts.
import type { EvmCurvePoint } from '@liwan/contracts'
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

/** The curve's points as numbers on the day axis; today is clamped into the plotted span so its marks stay in view. */
export function curveSeries(curve: EvmCurvePoint[], asOf: string) {
  const points = curve.map(point => ({ day: dayNumber(point.date), pv: point.pv }))
  const first = points[0]?.day ?? dayNumber(asOf)
  const last = points.at(-1)?.day ?? first
  return { points, today: Math.min(Math.max(dayNumber(asOf), first), last), first, last }
}
