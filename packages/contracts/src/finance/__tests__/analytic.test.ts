import {
  FinanceAnalyticAccountCreateSchema,
  FinanceAnalyticAccountListSchema,
  FinanceAnalyticAccountPatchSchema,
  FinanceAnalyticPlanCreateSchema,
  FinanceAnalyticPlanListSchema,
  FinanceAnalyticPlanPatchSchema,
  FinanceAnalyticReportLineListSchema,
  FinanceAnalyticReportSchema,
  FinanceInvoiceCreateSchema,
  FinanceInvoiceDetailSchema,
  JournalEntryCreateSchema,
} from '..'

const ACCOUNT_REF = { id: 5, name: 'Riyadh', code: 'RYD' }
const PLAN = { id: 3, name: 'Branches', parent: null }
const ACCOUNT = { ...ACCOUNT_REF, plan: { id: 3, name: 'Branches' }, active: true }

describe('finance analytic schemas', () => {
  it('parse plans and cost centers in the list envelope and are strict', () => {
    expect(FinanceAnalyticPlanListSchema.parse({ items: [PLAN], total: 1 })).toEqual({ items: [PLAN], total: 1 })
    expect(FinanceAnalyticAccountListSchema.parse({ items: [ACCOUNT], total: 1 })).toEqual({ items: [ACCOUNT], total: 1 })
    expect(() => FinanceAnalyticAccountListSchema.parse({ items: [{ ...ACCOUNT, company: 1 }], total: 1 })).toThrow()
    expect(() => FinanceAnalyticPlanListSchema.parse({ items: [{ id: 1, name: 'x' }], total: 1 })).toThrow()
  })

  it('validate plan and account bodies', () => {
    expect(FinanceAnalyticPlanCreateSchema.parse({ name: 'Cities', parent_id: 3 })).toEqual({ name: 'Cities', parent_id: 3 })
    expect(() => FinanceAnalyticPlanCreateSchema.parse({ name: ' ' })).toThrow()
    expect(FinanceAnalyticPlanPatchSchema.parse({ name: 'Renamed' })).toEqual({ name: 'Renamed' })
    expect(() => FinanceAnalyticPlanPatchSchema.parse({ parent_id: 3 })).toThrow()
    expect(() => FinanceAnalyticPlanPatchSchema.parse({})).toThrow()
    expect(FinanceAnalyticAccountCreateSchema.parse({ name: 'Riyadh', plan_id: 3 })).toEqual({ name: 'Riyadh', plan_id: 3 })
    expect(() => FinanceAnalyticAccountCreateSchema.parse({ name: 'Riyadh' })).toThrow()
    expect(() => FinanceAnalyticAccountCreateSchema.parse({ name: 'Riyadh', plan_id: 3, company_id: 1 })).toThrow()
    expect(FinanceAnalyticAccountPatchSchema.parse({ active: false })).toEqual({ active: false })
    expect(() => FinanceAnalyticAccountPatchSchema.parse({})).toThrow()
  })

  it('parse the report and its drill-down', () => {
    const row = { account: ACCOUNT_REF, plan: { id: 3, name: 'Branches' }, income: 600, expense: 0, net: 600 }
    const report = {
      date_from: '2026-10-01', date_to: '2026-10-31', currency: 'SAR', plan: null,
      accounts: [row], totals: { income: 600, expense: 0, net: 600 },
    }
    expect(FinanceAnalyticReportSchema.parse(report)).toEqual(report)
    expect(() => FinanceAnalyticReportSchema.parse({ ...report, totals: { income: 1 } })).toThrow()
    const line = {
      id: 1, date: '2026-10-18', name: 'Consulting', ref: '', move: { id: 9, name: 'INV/2026/00001' },
      general_account: { id: 4, name: '4000 Sales' }, partner: null, kind: 'income', amount: 600,
    }
    expect(FinanceAnalyticReportLineListSchema.parse({ items: [line], total: 1 })).toEqual({ items: [line], total: 1 })
    expect(() => FinanceAnalyticReportLineListSchema.parse({ items: [{ ...line, kind: 'equity' }], total: 1 })).toThrow()
  })

  it('a document line takes a distribution object and returns a list of shares', () => {
    const line = { name: 'Consulting', price_unit: 1000, analytic_distribution: { 5: 60, 6: 40 } }
    expect(FinanceInvoiceCreateSchema.parse({ move_type: 'out_invoice', partner_id: 1, lines: [line] }).lines[0]).toEqual(line)
    for (const distribution of [{ 5: 0 }, { 5: 101 }, { 5: '60' }, { riyadh: 60 }, { '05': 60 }, { 0: 60 }, [60]]) {
      expect(() => FinanceInvoiceCreateSchema.parse({
        move_type: 'out_invoice', partner_id: 1, lines: [{ ...line, analytic_distribution: distribution }],
      })).toThrow()
    }
    const entryLine = { account_id: 4, name: 'Rent', debit: 500, analytic_distribution: { 5: 100 } }
    expect(JournalEntryCreateSchema.parse({
      journal_id: 3, date: '2026-10-18', lines: [entryLine, { account_id: 9, name: 'Rent', credit: 500 }],
    }).lines[0]).toEqual(entryLine)
    const share = { account: ACCOUNT_REF, percent: 60 }
    const detail = {
      id: 1, name: 'INV/1', move_type: 'out_invoice', state: 'posted', payment_state: 'paid',
      partner: null, journal: { id: 1, name: 'Sales' }, invoice_date: '2026-10-18', invoice_date_due: null, currency: 'SAR',
      amount_untaxed: 1000, amount_tax: 150, amount_total: 1150, amount_residual: 0, ref: '', debit_origin: null, credit_origin: null, zatca: null, allowed_actions: [], blocked_actions: [],
      lines: [{
        id: 1, name: 'x', account: null, quantity: 1, price_unit: 1000, discount: 0, taxes: [],
        price_subtotal: 1000, price_total: 1150, analytic_distribution: [share],
      }],
    }
    expect(FinanceInvoiceDetailSchema.parse(detail)).toEqual(detail)
    expect(() => FinanceInvoiceDetailSchema.parse({ ...detail, lines: [{ ...detail.lines[0], analytic_distribution: undefined }] })).toThrow()
  })
})
