import { describe, expect, it } from 'vitest'
import { budgetErrorKey } from '../budgetErrors'

describe('budget errors', () => {
  it('maps the known codes to a key', () => {
    expect(budgetErrorKey('not_draft')).toBe('financeBudgets.errors.notDraft')
    expect(budgetErrorKey('invalid_state')).toBe('financeBudgets.errors.invalidState')
    expect(budgetErrorKey('line_outside_budget')).toBe('financeBudgets.errors.lineOutsideBudget')
    expect(budgetErrorKey('budget_line_overlap')).toBe('financeBudgets.errors.lineOverlap')
    expect(budgetErrorKey('invalid_period')).toBe('financeBudgets.errors.invalidPeriod')
    expect(budgetErrorKey('cost_center_overlap')).toBe('financeBudgets.errors.costCenterOverlap')
    expect(budgetErrorKey('invalid')).toBeNull()
  })
})
