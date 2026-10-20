import { describe, expect, it } from 'vitest'
import { reportKpiTiles } from '../reportKpis'
import type { LoadedReport } from '../reportConfig'

const t = (key: string) => key
const n = (value: number) => String(value)
const buckets = { current: 100, days_1_30: 50, days_31_60: 25, days_61_90: 10, days_91_120: 5, days_over_120: 10, total: 200 }
const values = (report: LoadedReport) => Object.fromEntries(reportKpiTiles(report, t, n).map(tile => [tile.id, tile.value]))

describe('report KPI tiles', () => {
  it('shows the trial balance totals and their difference', () => {
    const totals = { initial_balance: 0, debit: 900, credit: 850, balance: 50, ending_balance: 50 }
    const report: LoadedReport = { slug: 'trial-balance', data: { date_from: '2026-10-01', date_to: '2026-10-20', target_move: 'posted', currency: 'SAR', accounts: [], totals } }
    expect(values(report)).toEqual({ debit: '900', credit: '850', difference: '50' })
    expect(reportKpiTiles(report, t, n).find(tile => tile.id === 'difference')?.tone).toBe('danger')
  })

  it('adds the two oldest buckets for the aged figure over 90 days', () => {
    const report: LoadedReport = { slug: 'aged-partner-balance', data: { date_to: '2026-10-20', kind: 'receivable', target_move: 'posted', currency: 'SAR', accounts: [], totals: buckets } }
    expect(values(report)).toEqual({ agedTotal: '200', agedCurrent: '100', agedOver90: '15' })
  })

  it('shows the single currency of a statement and none for several', () => {
    const block = (currency: string) => ({ currency, balance_forward: 0, amount_due: 30, ending_balance: 40, lines: [], buckets: null })
    const statement = (currencies: ReturnType<typeof block>[]): LoadedReport => ({ slug: 'partner-statement', data: { type: 'activity', kind: 'receivable', partner: { id: 1, name: 'x' }, date_from: '2026-10-01', date_to: '2026-10-20', currencies } })
    expect(values(statement([block('SAR')]))).toEqual({ amountDue: '30', endingBalance: '40' })
    expect(reportKpiTiles(statement([block('SAR'), block('USD')]), t, n)).toEqual([])
    expect(reportKpiTiles(statement([]), t, n)).toEqual([])
  })

  it('shows the VAT sections and the net payable, a refund when negative', () => {
    const section = (tax_amount: number) => ({ taxes: [], base: 0, tax_amount })
    const report = (net: number): LoadedReport => ({ slug: 'vat', data: { date_from: '2026-10-01', date_to: '2026-10-20', currency: 'SAR', sales: section(10), purchases: section(40), net_payable: net } })
    expect(values(report(-30))).toEqual({ salesTax: '10', purchaseTax: '40', netPayable: '-30' })
    expect(reportKpiTiles(report(-30), t, n).find(tile => tile.id === 'netPayable')?.tone).toBe('success')
    expect(reportKpiTiles(report(30), t, n).find(tile => tile.id === 'netPayable')?.tone).toBe('warning')
  })

  it('shows the withholding totals and nothing for the ledger', () => {
    expect(values({ slug: 'withholding', data: { date_from: '2026-10-01', date_to: '2026-10-20', currency: 'SAR', taxes: [], base: 500, withheld: 25 } })).toEqual({ withholdingBase: '500', withheld: '25' })
    expect(reportKpiTiles({ slug: 'general-ledger', data: { date_from: '2026-10-01', date_to: '2026-10-20', target_move: 'posted', currency: 'SAR', accounts: [] } }, t, n)).toEqual([])
  })
})
