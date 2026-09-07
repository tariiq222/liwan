import { describe, it, expect } from 'vitest'
import { FinanceEntryCreateSchema, FinanceEntryPatchSchema, FinanceSummarySchema } from '../project-finance'

describe('project finance contracts', () => {
  it('allows an explicit zero budget but requires positive dated expenses', () => {
    expect(FinanceEntryCreateSchema.safeParse({ kind: 'budget', title: 'Hosting', amount: 0 }).success).toBe(true)
    expect(FinanceEntryCreateSchema.safeParse({ kind: 'expense', title: 'Hosting', amount: 0, expense_date: '2026-09-07' }).success).toBe(false)
    expect(FinanceEntryCreateSchema.safeParse({ kind: 'expense', title: 'Hosting', amount: 50 }).success).toBe(false)
    expect(FinanceEntryCreateSchema.safeParse({ kind: 'expense', title: 'Hosting', amount: 50, expense_date: '2026-02-30' }).success).toBe(false)
  })
  it('rejects malformed amounts and unexpected client-owned fields', () => {
    for (const amount of [-1, NaN, Infinity, true, '10', 1e13]) expect(FinanceEntryCreateSchema.safeParse({ kind: 'budget', title: 'A', amount }).success).toBe(false)
    expect(FinanceEntryCreateSchema.safeParse({ kind: 'budget', title: ' ', amount: 1 }).success).toBe(false)
    expect(FinanceEntryCreateSchema.safeParse({ kind: 'budget', title: 'A', amount: 1, company_id: 2 }).success).toBe(false)
    expect(FinanceEntryCreateSchema.safeParse({ kind: 'budget', title: 'A', amount: 1, budget_entry_id: 3 }).success).toBe(false)
  })
  it('requires a revision and actual mutation for edits, and forbids kind changes', () => {
    expect(FinanceEntryPatchSchema.safeParse({ title: 'B' }).success).toBe(false)
    expect(FinanceEntryPatchSchema.safeParse({ expected_updated_at: 'v1' }).success).toBe(false)
    expect(FinanceEntryPatchSchema.safeParse({ title: 'B', expected_updated_at: 'v1' }).success).toBe(true)
    expect(FinanceEntryPatchSchema.safeParse({ kind: 'expense', expected_updated_at: 'v1' }).success).toBe(false)
  })
  it('preserves unknown budget separately from zero', () => {
    const summary = { project_id: 1, currency: { id: 1, name: 'SAR', symbol: 'SR', decimal_places: 2 }, charter_estimate: null, planned: null, actual: 0, remaining: null, utilization_percent: null, over_budget: false, budget_count: 0, expense_count: 0 }
    expect(FinanceSummarySchema.parse(summary).planned).toBeNull()
    expect(FinanceSummarySchema.parse({ ...summary, planned: 0, remaining: 0, budget_count: 1 }).planned).toBe(0)
  })
})
