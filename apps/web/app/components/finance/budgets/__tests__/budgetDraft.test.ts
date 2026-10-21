import { describe, expect, it } from 'vitest'
import { budgetDraftDirty, buildBudgetCreate, emptyBudgetDraft, hasBudgetErrors, validateBudgetDraft } from '../budgetDraft'

const valid = () => ({ name: ' Q4 ', description: '  ', dateFrom: '2026-10-01', dateTo: '2026-12-31', costCenterSplit: false })

describe('budget create form', () => {
  it('needs a name and both days', () => {
    expect(validateBudgetDraft(emptyBudgetDraft())).toEqual({ name: true, dateFrom: true, dateTo: true, order: false })
    expect(hasBudgetErrors(validateBudgetDraft(valid()))).toBe(false)
  })

  it('refuses a period that ends before it starts', () => {
    expect(validateBudgetDraft({ ...valid(), dateTo: '2026-09-01' }).order).toBe(true)
    expect(validateBudgetDraft({ ...valid(), dateTo: '2026-10-01' }).order).toBe(false)
  })

  it('builds a trimmed body without an empty description', () => {
    expect(buildBudgetCreate(valid())).toEqual({ name: 'Q4', date_from: '2026-10-01', date_to: '2026-12-31' })
    expect(buildBudgetCreate({ ...valid(), description: ' notes ' })).toMatchObject({ description: 'notes' })
  })

  it('sends the cost center split only when it is switched on', () => {
    expect(buildBudgetCreate({ ...valid(), costCenterSplit: true })).toMatchObject({ cost_center_split: true })
    expect(buildBudgetCreate(valid())).not.toHaveProperty('cost_center_split')
  })

  it('is dirty once anything is typed', () => {
    expect(budgetDraftDirty(emptyBudgetDraft())).toBe(false)
    expect(budgetDraftDirty({ ...emptyBudgetDraft(), name: 'x' })).toBe(true)
  })
})
