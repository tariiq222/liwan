import { describe, expect, it } from 'vitest'
import { budgetErrorKey } from '../budgetErrors'

describe('budget errors', () => {
  it('maps the known codes to a key', () => {
    expect(budgetErrorKey('not_draft')).toBe('financeBudgets.errors.notDraft')
    expect(budgetErrorKey('invalid_state')).toBe('financeBudgets.errors.invalidState')
    expect(budgetErrorKey('invalid')).toBeNull()
  })
})
