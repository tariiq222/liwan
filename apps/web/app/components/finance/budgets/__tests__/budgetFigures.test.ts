import { describe, expect, it } from 'vitest'
import { formatPercent, sideTone } from '../budgetFigures'

const totals = (budget: number, actual: number) => ({ budget, actual, variance: budget - actual, variance_percent: null })

describe('side tone', () => {
  it('a debit side is favorable at or under the budget', () => {
    expect(sideTone('debit', totals(100, 80))).toBe('success')
    expect(sideTone('debit', totals(100, 100))).toBe('success')
    expect(sideTone('debit', totals(100, 120))).toBe('danger')
  })

  it('a credit side is favorable at or over the budget', () => {
    expect(sideTone('credit', totals(100, 120))).toBe('success')
    expect(sideTone('credit', totals(100, 80))).toBe('danger')
  })

  it('a side with nothing budgeted or booked is neutral', () => {
    expect(sideTone('debit', totals(0, 0))).toBe('neutral')
  })
})

describe('percent', () => {
  it('has one decimal, and is empty when the budget was zero', () => {
    expect(formatPercent(12.345)).toBe('12.3%')
    expect(formatPercent(-8)).toBe('-8.0%')
    expect(formatPercent(null)).toBeNull()
  })
})
