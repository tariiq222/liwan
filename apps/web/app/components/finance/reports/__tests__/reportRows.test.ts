import { describe, expect, it } from 'vitest'
import type { FinanceAgedPartnerBalance, FinanceGeneralLedger, FinancePartnerStatement, FinanceVatSummary } from '@webvue/contracts'
import { agedRows, ledgerRows, selectedLedgerLines, statementRows, vatRows } from '../reportRows'

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
})
