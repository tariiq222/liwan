import type { FinanceBudgetVsActual } from '@webvue/contracts'

type Side = 'debit' | 'credit'
export type FigureTone = 'success' | 'danger' | 'neutral'

/**
 * The tone of a side's totals. Variance is budget less actual: a debit side (spending) is favorable at or above zero,
 * a credit side (income) at or below it. A side with no budget stays neutral.
 */
export function sideTone(side: Side, totals: FinanceBudgetVsActual['totals'][Side]): FigureTone {
  if (totals.budget === 0 && totals.actual === 0) return 'neutral'
  const favorable = side === 'debit' ? totals.variance >= 0 : totals.variance <= 0
  return favorable ? 'success' : 'danger'
}

/** A variance in percent of the budget with one decimal and a Latin sign; null when the budget is zero. */
export function formatPercent(value: number | null): string | null {
  return value === null ? null : `${value.toFixed(1)}%`
}
