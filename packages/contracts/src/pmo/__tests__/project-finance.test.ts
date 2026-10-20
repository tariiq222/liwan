import { describe, it, expect } from 'vitest'
import { ActualAccountPatchSchema, ActualLineListSchema, FinanceEntryCreateSchema, FinanceEntryPatchSchema, FinanceSummarySchema } from '../project-finance'

const summary = { project_id: 1, currency: { id: 1, name: 'SAR', symbol: 'SR', decimal_places: 2 }, charter_estimate: null, planned: null, actual: 0, remaining: null, utilization_percent: null, over_budget: false, budget_count: 0, expense_count: 0, actual_source: 'manual', actual_account: null, can_read_actual_lines: false, can_choose_actual_account: false }

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
    expect(FinanceSummarySchema.parse(summary).planned).toBeNull()
    expect(FinanceSummarySchema.parse({ ...summary, planned: 0, remaining: 0, budget_count: 1 }).planned).toBe(0)
  })
  it('takes a negative actual and the linked account from an external source', () => {
    const external = { ...summary, actual: -40, actual_source: 'external', actual_account: { id: 7, name: 'Tower', code: null }, can_read_actual_lines: true, can_choose_actual_account: true }
    expect(FinanceSummarySchema.parse(external).actual_account).toEqual({ id: 7, name: 'Tower', code: null })
    expect(FinanceSummarySchema.safeParse({ ...external, actual_source: 'other' }).success).toBe(false)
    expect(FinanceSummarySchema.safeParse({ ...external, actual: NaN }).success).toBe(false)
    expect(FinanceSummarySchema.safeParse({ ...external, actual_account: { id: 7, name: 'Tower' } }).success).toBe(false)
  })
  it('takes a negative utilization when a net refund makes the actual negative', () => {
    const refunded = { ...summary, planned: 1000, actual: -200, remaining: 1200, utilization_percent: -20 }
    expect(FinanceSummarySchema.parse(refunded).utilization_percent).toBe(-20)
    expect(FinanceSummarySchema.safeParse({ ...refunded, utilization_percent: NaN }).success).toBe(false)
  })
  it('parses actual lines with an optional record link and partner', () => {
    const line = { id: 1, date: '2026-10-01', label: 'Cement', reference: null, partner: null, amount: -25.5, record: null }
    expect(ActualLineListSchema.parse({ items: [line, { ...line, id: 2, reference: 'BILL/1', partner: { id: 3, name: 'Acme' }, record: { kind: 'finance-bill', id: 9 } }], total: 2 }).total).toBe(2)
    expect(ActualLineListSchema.safeParse({ items: [{ ...line, date: '2026-02-30' }], total: 1 }).success).toBe(false)
    expect(ActualLineListSchema.safeParse({ items: [{ ...line, extra: 1 }], total: 1 }).success).toBe(false)
  })
  it('patches the actual account with a positive id or null, nothing else', () => {
    expect(ActualAccountPatchSchema.parse({ account_id: 4 }).account_id).toBe(4)
    expect(ActualAccountPatchSchema.parse({ account_id: null }).account_id).toBeNull()
    for (const body of [{}, { account_id: 0 }, { account_id: 1.5 }, { account_id: '4' }, { account_id: 4, name: 'x' }]) expect(ActualAccountPatchSchema.safeParse(body).success).toBe(false)
  })
})
