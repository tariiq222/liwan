import { describe, expect, it } from 'vitest'
import { kpiSharesApply } from '../kpiShares'

describe('kpiSharesApply', () => {
  it('shows shares for an unfiltered or search-only list', () => {
    expect(kpiSharesApply({})).toBe(true)
    expect(kpiSharesApply({ state: [] })).toBe(true)
    expect(kpiSharesApply({ deadline: 'today' })).toBe(true)
  })
  it('hides shares for the overdue deadline and for any state selection', () => {
    expect(kpiSharesApply({ deadline: 'overdue' })).toBe(false)
    expect(kpiSharesApply({ state: ['done'] })).toBe(false)
    expect(kpiSharesApply({ state: ['waiting', 'cancelled'] })).toBe(false)
  })
})
