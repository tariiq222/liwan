import { describe, expect, it } from 'vitest'
import type { FinanceAgedPartnerBalance, FinanceAnalyticReport, FinanceAnalyticReportLine, FinanceGeneralLedger, FinancePartnerStatement, FinanceVatSummary } from '@webvue/contracts'
import { agedRows, analyticRows, ledgerRows, misRows, misValue, selectedLedgerLines, statementRows, vatRows, ZAKAT_RESULT_CODES } from '../reportRows'

const buckets = { current: 1, days_1_30: 0, days_31_60: 0, days_61_90: 0, days_91_120: 0, days_over_120: 0, total: 1 }
const line = (id: number) => ({ id, date: '2026-10-01', entry: `E${id}`, journal: 'BNK1', partner: null, label: '', debit: 1, credit: 0, balance: 1 })
const ledger: FinanceGeneralLedger = {
  date_from: '2026-10-01', date_to: '2026-10-20', target_move: 'posted', currency: 'SAR',
  accounts: [1, 2].map(id => ({ account: { id, code: `10${id}`, name: `A${id}` }, initial_balance: 0, debit: 0, credit: 0, ending_balance: 0, lines: { items: id === 2 ? [line(8), line(9)] : [], total: 5 } })),
}

describe('report table rows', () => {
  it('opens only the selected ledger account under its row', () => {
    expect(ledgerRows(ledger, null).map(row => row.key)).toEqual(['a1', 'a2'])
    expect(ledgerRows(ledger, 2).map(row => row.key)).toEqual(['a1', 'a2', 'l8', 'l9'])
    expect(selectedLedgerLines(ledger, 2)?.total).toBe(5)
    expect(selectedLedgerLines(ledger, null)).toBeNull()
  })

  it('lists each aged account before its partners, the unassigned one included', () => {
    const report: FinanceAgedPartnerBalance = {
      date_to: '2026-10-20', kind: 'receivable', target_move: 'posted', currency: 'SAR', totals: buckets,
      accounts: [{ account: { id: 5, code: '120', name: 'AR' }, ...buckets, partners: [{ partner: { id: 3, name: 'P' }, ...buckets }, { partner: null, ...buckets }] }],
    }
    expect(agedRows(report).map(row => [row.kind, row.key, row.name])).toEqual([['account', 'a5', 'AR'], ['partner', 'a5p3', 'P'], ['partner', 'a5p0', null]])
  })

  it('opens each statement currency with its balance forward', () => {
    const block = (currency: string, forward: number) => ({ currency, balance_forward: forward, amount_due: 0, ending_balance: 0, buckets: null, lines: [{ date: '2026-10-02', date_due: '2026-10-02', entry: 'E', ref: '', label: 'L', debit: 2, credit: 0, open_amount: 2, balance: forward + 2 }] })
    const report: FinancePartnerStatement = { type: 'activity', kind: 'receivable', partner: { id: 1, name: 'P' }, date_from: '2026-10-01', date_to: '2026-10-20', currencies: [block('SAR', 10), block('USD', 20)] }
    const rows = statementRows(report)
    expect(rows.map(row => [row.currency, row.forward, row.balance])).toEqual([['SAR', true, 10], ['SAR', false, 12], ['USD', true, 20], ['USD', false, 22]])
  })

  it('closes each VAT section with its total row', () => {
    const section = (id: number) => ({ taxes: [{ tax: { id, name: 'VAT' }, rate: 15, base: 100, tax_amount: 15 }], base: 100, tax_amount: 15 })
    const report: FinanceVatSummary = { date_from: '2026-10-01', date_to: '2026-10-20', currency: 'SAR', sales: section(1), purchases: section(2), net_payable: 0 }
    expect(vatRows(report).map(row => [row.key, row.tax?.name ?? null])).toEqual([['sales1', 'VAT'], ['sales-total', null], ['purchases2', 'VAT'], ['purchases-total', null]])
  })

  it('opens only the selected cost center under its row', () => {
    const row = (id: number) => ({ account: { id, name: `C${id}`, code: `C${id}` }, plan: { id: 1, name: 'P' }, income: 0, expense: 0, net: 0 })
    const report: FinanceAnalyticReport = { date_from: '2026-10-01', date_to: '2026-10-20', currency: 'SAR', plan: null, accounts: [row(1), row(2)], totals: { income: 0, expense: 0, net: 0 } }
    const item = (id: number): FinanceAnalyticReportLine => ({ id, date: '2026-10-02', name: 'n', ref: '', move: null, general_account: { id: 1, name: 'G' }, partner: null, kind: 'income', amount: 5 })
    expect(analyticRows(report, null, [item(8)]).map(r => r.key)).toEqual(['a1', 'a2'])
    expect(analyticRows(report, 2, [item(8), item(9)]).map(r => r.key)).toEqual(['a1', 'a2', 'l8', 'l9'])
  })
})

describe('MIS report rows', () => {
  const lines = [
    { code: 'revenue', label: 'Revenue', value: 500 },
    { code: 'gross_profit', label: 'Gross profit', value: 300 },
    { code: 'net_profit', label: 'Net profit', value: 120 },
    { code: 'zakat_base', label: 'Zakat base', value: 9 },
  ]

  it('marks the subtotals of each report bold and nothing else', () => {
    expect(misRows('profitLoss', lines).map(row => [row.code, row.strong])).toEqual([['revenue', false], ['gross_profit', true], ['net_profit', true], ['zakat_base', false]])
    expect(misRows('zakatBase', [{ code: 'total_additions', label: '', value: 1 }, { code: 'net_profit', label: '', value: 2 }]).map(row => row.strong)).toEqual([true, false])
    expect(misRows('balanceSheet', [{ code: 'total_assets', label: '', value: 1 }, { code: 'cash', label: '', value: 2 }]).map(row => row.strong)).toEqual([true, false])
  })

  it('keeps the server label for the locale fallback and drops the hidden codes', () => {
    expect(misRows('zakatBase', lines, ZAKAT_RESULT_CODES).map(row => row.code)).toEqual(['revenue', 'gross_profit', 'net_profit'])
    expect(misRows('profitLoss', lines)[0]).toEqual({ code: 'revenue', label: 'Revenue', value: 500, strong: false })
  })

  it('finds a line value by code', () => {
    expect(misValue(lines, 'gross_profit')).toBe(300)
    expect(misValue(lines, 'depreciation')).toBeUndefined()
  })
})
