import { FinanceBudgetLineCreateSchema, FinanceBudgetLinePatchSchema, type FinanceBudgetLine } from '@liwan/contracts'
import { describe, expect, it } from 'vitest'
import { budgetLineDraftFrom, buildBudgetLine, buildBudgetLinePatch, emptyBudgetLine, hasBudgetLineErrors, validateBudgetLine } from '../budgetLineDraft'

const valid = () => ({ ...emptyBudgetLine(), accountId: 21, amount: '1500.5' })

describe('budget line form', () => {
  it('needs an account and an amount of zero or more', () => {
    expect(validateBudgetLine(emptyBudgetLine())).toEqual({ account: true, amount: true, order: false })
    expect(hasBudgetLineErrors(validateBudgetLine(valid()))).toBe(false)
    expect(validateBudgetLine({ ...valid(), amount: '0' }).amount).toBe(false)
    expect(validateBudgetLine({ ...valid(), amount: '-1' }).amount).toBe(true)
    expect(validateBudgetLine({ ...valid(), amount: 'abc' }).amount).toBe(true)
  })

  it('refuses a period that ends before it starts', () => {
    expect(validateBudgetLine({ ...valid(), dateFrom: '2026-05-01', dateTo: '2026-04-01' }).order).toBe(true)
    expect(validateBudgetLine({ ...valid(), dateFrom: '2026-05-01' }).order).toBe(false)
  })

  it('sends only what was filled in, and satisfies the contract', () => {
    expect(buildBudgetLine(valid())).toEqual({ account_id: 21, amount: 1500.5 })
    const full = buildBudgetLine({ ...valid(), label: ' رواتب ', dateFrom: '2026-01-01', dateTo: '2026-03-31' })
    expect(full).toEqual({ account_id: 21, amount: 1500.5, label: 'رواتب', date_from: '2026-01-01', date_to: '2026-03-31' })
    expect(FinanceBudgetLineCreateSchema.safeParse(full).success).toBe(true)
  })
})

describe('editing a budget line', () => {
  const budget = { date_from: '2026-01-01', date_to: '2026-12-31' }
  const line: FinanceBudgetLine = {
    id: 4,
    account: { id: 21, name: 'Salaries' },
    nature: 'debit',
    analytic_account: { id: 9, name: 'Riyadh' },
    label: 'Q2',
    date_from: '2026-04-01',
    date_to: '2026-06-30',
    amount: 1200,
  }

  it('fills the form from the stored line', () => {
    expect(budgetLineDraftFrom(line)).toEqual({ accountId: 21, amount: '1200', label: 'Q2', dateFrom: '2026-04-01', dateTo: '2026-06-30' })
  })

  it('sends the edited fields, clears an emptied label and keeps the cost center', () => {
    const body = buildBudgetLinePatch({ ...budgetLineDraftFrom(line), amount: '900', label: ' ' }, budget)
    expect(body).toEqual({ account_id: 21, amount: 900, label: '', date_from: '2026-04-01', date_to: '2026-06-30' })
    expect(body).not.toHaveProperty('analytic_account_id')
    expect(FinanceBudgetLinePatchSchema.safeParse(body).success).toBe(true)
  })

  it('falls back to the budget period when a date is cleared', () => {
    const body = buildBudgetLinePatch({ ...budgetLineDraftFrom(line), dateFrom: null, dateTo: null }, budget)
    expect(body).toMatchObject({ date_from: '2026-01-01', date_to: '2026-12-31' })
  })
})
