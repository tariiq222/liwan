import {
  FinanceBudgetCreateSchema,
  FinanceBudgetDetailSchema,
  FinanceBudgetLineCreateSchema,
  FinanceBudgetLinePatchSchema,
  FinanceBudgetListSchema,
  FinanceBudgetPatchSchema,
  FinanceBudgetVsActualSchema,
} from '..'

const REF = { id: 4, name: '600901 Rent' }
const BUDGET = {
  id: 1, name: 'Budget 2026', description: '', state: 'draft', date_from: '2026-01-01', date_to: '2026-12-31',
  currency: 'SAR', line_count: 1,
}
const LINE = {
  id: 9, account: REF, nature: 'debit', analytic_account: null, label: '', date_from: '2026-01-01',
  date_to: '2026-12-31', amount: 10000,
}
const { amount: _amount, ...ROW } = LINE
const FIGURES = { budget: 10000, actual: 7500, variance: 2500, variance_percent: 25 }

describe('finance budget schemas', () => {
  it('parse the list and the detail with its lines, and are strict', () => {
    expect(FinanceBudgetListSchema.parse({ items: [BUDGET], total: 1 })).toEqual({ items: [BUDGET], total: 1 })
    const detail = { ...BUDGET, lines: [LINE] }
    expect(FinanceBudgetDetailSchema.parse(detail)).toEqual(detail)
    expect(() => FinanceBudgetDetailSchema.parse({ ...detail, state: 'closed' })).toThrow()
    expect(() => FinanceBudgetDetailSchema.parse({ ...detail, lines: [{ ...LINE, nature: 'both' }] })).toThrow()
    expect(() => FinanceBudgetDetailSchema.parse({ ...detail, lines: [{ ...LINE, secret: 1 }] })).toThrow()
    expect(() => FinanceBudgetListSchema.parse({ items: [{ ...BUDGET, secret: 1 }], total: 1 })).toThrow()
  })

  it('parse the budget versus actual report with totals per nature', () => {
    const report = {
      budget: { id: 1, name: 'Budget 2026', state: 'confirmed' },
      date_from: '2026-01-01', date_to: '2026-12-31', currency: 'SAR', target_move: 'posted',
      lines: [{ ...ROW, ...FIGURES, favorable: true }, { ...ROW, id: 10, nature: 'credit', ...FIGURES, variance_percent: null, favorable: false }],
      totals: { debit: FIGURES, credit: FIGURES, net: { budget: 0, actual: 0 } },
    }
    expect(FinanceBudgetVsActualSchema.parse(report)).toEqual(report)
    expect(() => FinanceBudgetVsActualSchema.parse({ ...report, totals: { ...report.totals, extra: FIGURES } })).toThrow()
    expect(() => FinanceBudgetVsActualSchema.parse({ ...report, target_move: 'all' })).toThrow()
    expect(() => FinanceBudgetVsActualSchema.parse({ ...report, lines: [{ ...report.lines[0], favorable: 'yes' }] })).toThrow()
  })

  it('accept the request bodies and reject unknown keys, negative amounts and bad dates', () => {
    const budget = { name: 'B', date_from: '2026-01-01', date_to: '2026-12-31' }
    expect(FinanceBudgetCreateSchema.parse(budget)).toEqual(budget)
    expect(() => FinanceBudgetCreateSchema.parse({ ...budget, state: 'confirmed' })).toThrow()
    expect(() => FinanceBudgetCreateSchema.parse({ name: 'B' })).toThrow()
    expect(FinanceBudgetPatchSchema.parse({ name: 'C' })).toEqual({ name: 'C' })
    expect(() => FinanceBudgetPatchSchema.parse({ date_to: '31/12/2026' })).toThrow()
    const line = { account_id: 4, amount: 10 }
    expect(FinanceBudgetLineCreateSchema.parse({ ...line, analytic_account_id: null })).toEqual({ ...line, analytic_account_id: null })
    expect(() => FinanceBudgetLineCreateSchema.parse({ account_id: 4 })).toThrow()
    expect(() => FinanceBudgetLineCreateSchema.parse({ ...line, amount: -1 })).toThrow()
    expect(() => FinanceBudgetLineCreateSchema.parse({ ...line, amount: '10' })).toThrow()
    expect(() => FinanceBudgetLineCreateSchema.parse({ ...line, budget_id: 1 })).toThrow()
    expect(FinanceBudgetLinePatchSchema.parse({ amount: 0 })).toEqual({ amount: 0 })
  })
})
