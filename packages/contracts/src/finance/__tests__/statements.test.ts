import {
  FinanceAgedPartnerBalanceSchema,
  FinanceBalanceSheetSchema,
  FinanceGeneralLedgerSchema,
  FinancePartnerStatementSchema,
  FinanceProfitLossSchema,
  FinanceTrialBalanceSchema,
  FinanceZakatBaseSchema,
} from '..'

const ACCOUNT = { id: 12, code: '101001', name: 'Bank' }
const AMOUNTS = { initial_balance: 5000, debit: 110000, credit: 12000, balance: 98000, ending_balance: 103000 }
const BUCKETS = {
  current: 230, days_1_30: 115, days_31_60: 750, days_61_90: 0, days_91_120: 0, days_over_120: 0, total: 1095,
}
const HEADER = { target_move: 'posted', currency: 'SAR' }

describe('finance statement schemas', () => {
  it('parse the trial balance and are strict', () => {
    const report = {
      date_from: '2026-01-01',
      date_to: '2026-12-31',
      ...HEADER,
      accounts: [{ account: ACCOUNT, ...AMOUNTS }],
      totals: AMOUNTS,
    }
    expect(FinanceTrialBalanceSchema.parse(report)).toEqual(report)
    expect(() => FinanceTrialBalanceSchema.parse({ ...report, target_move: 'draft' })).toThrow()
    expect(() => FinanceTrialBalanceSchema.parse({ ...report, extra: 1 })).toThrow()
    expect(() => FinanceTrialBalanceSchema.parse({ ...report, accounts: [{ account: ACCOUNT, ...AMOUNTS, name: 'x' }] })).toThrow()
  })

  it('parse the general ledger with a page of lines', () => {
    const line = {
      id: 9, date: '2026-01-02', entry: 'MISC/2026/01/0001', journal: 'MISC', partner: null, label: 'entry',
      debit: 100000, credit: 0, balance: 105000,
    }
    const report = {
      date_from: '2026-01-01',
      date_to: '2026-12-31',
      ...HEADER,
      accounts: [{
        account: ACCOUNT, initial_balance: 5000, debit: 110000, credit: 12000, ending_balance: 103000,
        lines: { items: [line], total: 3 },
      }],
    }
    expect(FinanceGeneralLedgerSchema.parse(report)).toEqual(report)
    expect(() => FinanceGeneralLedgerSchema.parse({ ...report, accounts: [{ ...report.accounts[0], lines: [line] }] })).toThrow()
    const totalsOnly = { ...report, accounts: [{ ...report.accounts[0], lines: { items: [], total: 3 } }] }
    expect(FinanceGeneralLedgerSchema.parse(totalsOnly)).toEqual(totalsOnly)
  })

  it('parse the aged partner balance', () => {
    const report = {
      date_to: '2026-11-30',
      kind: 'receivable',
      ...HEADER,
      accounts: [{
        account: { id: 3, code: '102011', name: 'Accounts Receivable' },
        ...BUCKETS,
        partners: [{ partner: { id: 5, name: 'Al Noor Trading' }, ...BUCKETS }],
      }],
      totals: BUCKETS,
    }
    expect(FinanceAgedPartnerBalanceSchema.parse(report)).toEqual(report)
    const partnerless = { ...report, accounts: [{ ...report.accounts[0], partners: [{ partner: null, ...BUCKETS }] }] }
    expect(FinanceAgedPartnerBalanceSchema.parse(partnerless)).toEqual(partnerless)
    expect(() => FinanceAgedPartnerBalanceSchema.parse({ ...report, kind: 'other' })).toThrow()
    expect(() => FinanceAgedPartnerBalanceSchema.parse({ ...report, totals: { ...BUCKETS, current: 'x' } })).toThrow()
  })

  it('parse an activity and an outstanding partner statement', () => {
    const block = {
      currency: 'SAR',
      balance_forward: 0,
      amount_due: 750,
      ending_balance: 750,
      lines: [{
        date: '2026-10-18', date_due: '2026-10-18', entry: 'INV/2026/00001', ref: '', label: '',
        debit: 1150, credit: 0, open_amount: 750, balance: 1150,
      }],
      buckets: BUCKETS,
    }
    const activity = {
      type: 'activity', kind: 'receivable', partner: { id: 5, name: 'Al Noor Trading' },
      date_from: '2026-10-01', date_to: '2026-10-31', currencies: [block],
    }
    expect(FinancePartnerStatementSchema.parse(activity)).toEqual(activity)
    const outstanding = {
      ...activity, type: 'outstanding', date_from: null,
      currencies: [{ ...block, lines: [{ ...block.lines[0], balance: null }] }],
    }
    expect(FinancePartnerStatementSchema.parse(outstanding)).toEqual(outstanding)
    expect(() => FinancePartnerStatementSchema.parse({ ...activity, type: 'detailed' })).toThrow()
  })

  it('parse the MIS reports: lines with stable codes, and the Zakat base with its disclaimer', () => {
    const lines = [{ code: 'revenue', label: 'Revenue', value: 1300 }]
    const managementInformation = { statutory: false, status: 'management_information' as const }
    const loss = { date_from: '2026-01-01', date_to: '2026-12-31', ...HEADER, ...managementInformation, lines }
    const sheet = { date_to: '2026-12-31', ...HEADER, ...managementInformation, lines }
    expect(FinanceProfitLossSchema.parse(loss)).toEqual(loss)
    expect(FinanceBalanceSheetSchema.parse(sheet)).toEqual(sheet)
    for (const schema of [FinanceProfitLossSchema, FinanceBalanceSheetSchema]) {
      expect(() => schema.parse({ ...sheet, statutory: undefined })).toThrow()
      expect(() => schema.parse({ ...sheet, statutory: true })).toThrow()
      expect(() => schema.parse({ ...sheet, status: 'reviewed' })).toThrow()
    }
    expect(() => FinanceBalanceSheetSchema.parse({ ...sheet, lines: [{ code: '', label: 'x', value: 1 }] })).toThrow()
    const zakat = {
      date_to: '2026-12-31', ...HEADER, lines, template_base: 103900, adjustments: [], adjustments_total: 0, base: 103900, rate: 0.0257768, zakat_due: 2678.1,
      status: 'management_information', filed: false, review: null, disclaimer: 'Review by a Saudi CPA.',
    }
    expect(FinanceZakatBaseSchema.parse(zakat)).toEqual(zakat)
    expect(() => FinanceZakatBaseSchema.parse({ ...zakat, disclaimer: '' })).toThrow()
    expect(() => FinanceZakatBaseSchema.parse({ ...sheet, base: 1, rate: 0.0257768, zakat_due: 1 })).toThrow()
    expect(() => FinanceZakatBaseSchema.parse({ ...zakat, filed: true })).toThrow()
  })
})
