// Presentation of schedule variance: days after the baseline date. Pure, see __tests__/variance.test.ts.
import type { StateTone } from '@/composables/taskState'

/** "+3" for three days late, "−2" for two days early, "0" on the baseline date, null when a date is missing. */
export function varianceLabel(days: number | null): string | null {
  if (days === null) return null
  return days === 0 ? '0' : `${days > 0 ? '+' : '−'}${Math.abs(days)}`
}

/** Late is a problem, early is good news, on the date or undated says nothing. */
export function varianceTone(days: number | null): StateTone {
  if (days === null || days === 0) return 'neutral'
  return days > 0 ? 'destructive' : 'success'
}
