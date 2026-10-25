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

  it('shows the cost center totals, a loss in the danger tone', () => {
    const report = (net: number): LoadedReport => ({ slug: 'analytic', data: { date_from: '2026-10-01', date_to: '2026-10-20', currency: 'SAR', plan: null, accounts: [], totals: { income: 100, expense: 100 - net, net } } })
    expect(values(report(-20))).toEqual({ income: '100', expense: '120', net: '-20' })
    expect(reportKpiTiles(report(-20), t, n).find(tile => tile.id === 'net')?.tone).toBe('danger')
    expect(reportKpiTiles(report(20), t, n).find(tile => tile.id === 'net')?.tone).toBe('neutral')
  })

  it('shows the withholding totals and nothing for the ledger', () => {
    expect(values({ slug: 'withholding', data: { date_from: '2026-10-01', date_to: '2026-10-20', currency: 'SAR', taxes: [], base: 500, withheld: 25 } })).toEqual({ withholdingBase: '500', withheld: '25' })
    expect(reportKpiTiles({ slug: 'general-ledger', data: { date_from: '2026-10-01', date_to: '2026-10-20', target_move: 'posted', currency: 'SAR', accounts: [] } }, t, n)).toEqual([])
  })

  const lines = (...pairs: [string, number][]) => pairs.map(([code, value]) => ({ code, label: code, value }))

  it('shows revenue, gross profit and net profit, a loss in the danger tone', () => {
    const report = (net: number): LoadedReport => ({ slug: 'profit-loss', data: { date_from: '2026-10-01', date_to: '2026-10-20', target_move: 'posted', currency: 'SAR', statutory: false, status: 'management_information', lines: lines(['revenue', 500], ['gross_profit', 300], ['net_profit', net]) } })
    expect(values(report(-20))).toEqual({ revenue: '500', grossProfit: '300', netProfit: '-20' })
    expect(reportKpiTiles(report(-20), t, n).find(tile => tile.id === 'netProfit')?.tone).toBe('danger')
    expect(reportKpiTiles(report(20), t, n).find(tile => tile.id === 'netProfit')?.tone).toBe('neutral')
  })

  it('leaves out a tile whose line the server did not send', () => {
    const report: LoadedReport = { slug: 'profit-loss', data: { date_from: '2026-10-01', date_to: '2026-10-20', target_move: 'posted', currency: 'SAR', statutory: false, status: 'management_information', lines: lines(['revenue', 500]) } }
    expect(values(report)).toEqual({ revenue: '500' })
  })

  it('shows the balance sheet totals', () => {
    const report: LoadedReport = { slug: 'balance-sheet', data: { date_to: '2026-10-20', target_move: 'posted', currency: 'SAR', statutory: false, status: 'management_information', lines: lines(['total_assets', 455], ['total_liabilities', 142], ['total_equity', 313]) } }
    expect(values(report)).toEqual({ totalAssets: '455', totalLiabilities: '142', equity: '313' })
  })

  it('shows the Zakat base, rate and due, the due in the warning tone when positive', () => {
    const report = (due: number): LoadedReport => ({ slug: 'zakat-base', data: { date_to: '2026-10-20', target_move: 'posted', currency: 'SAR', lines: [], template_base: 1000, adjustments: [], adjustments_total: 0, base: 1000, rate: 0.025, zakat_due: due, status: 'management_information', filed: false, review: null, disclaimer: 'x' } })
    expect(values(report(25))).toEqual({ zakatBase: '1000', zakatRate: '0.025', zakatDue: '25' })
    expect(reportKpiTiles(report(25), t, n).find(tile => tile.id === 'zakatDue')?.tone).toBe('warning')
    expect(reportKpiTiles(report(0), t, n).find(tile => tile.id === 'zakatDue')?.tone).toBe('neutral')
  })

  it('shows the budget sides with their budget as the hint, and the net', () => {
    const side = (budget: number, actual: number) => ({ budget, actual, variance: budget - actual, variance_percent: null })
    const report: LoadedReport = { slug: 'budget-vs-actual', data: { budget: { id: 1, name: 'x', state: 'confirmed' }, date_from: '2026-01-01', date_to: '2026-06-30', currency: 'SAR', target_move: 'posted', lines: [], totals: { debit: side(100, 120), credit: side(300, 350), net: { budget: 200, actual: 230 } } } }
    expect(values(report)).toEqual({ budgetDebit: '120', budgetCredit: '350', budgetNet: '230' })
    const tiles = reportKpiTiles(report, t, n)
    expect(tiles.find(tile => tile.id === 'budgetDebit')).toMatchObject({ tone: 'danger', hint: 'financeReports.kpi.budgetOf' })
    expect(tiles.find(tile => tile.id === 'budgetCredit')?.tone).toBe('success')
  })
})

describe('cash flow and VAT return tiles', () => {
  const t = (key: string) => key
  const n = (value: number) => String(value)
  const cashFlow = (difference: number): LoadedReport => ({ slug: 'cash-flow', data: { date_from: '2026-10-01', date_to: '2026-10-31', currency: 'SAR', basis: 'indirect', statutory: false, opening_cash: 50000, closing_cash: 50975, net_change: 975, operating: { net_income: 975, adjustments: [], items: [], total: 975 }, investing: { items: [], depreciation_reclass: 0, total: 0 }, financing: { items: [], total: 0 }, total_change: 975, difference } })

  it('shows the cash at both ends and flags a statement that does not close', () => {
    expect(reportKpiTiles(cashFlow(0), t, n).map(tile => [tile.id, tile.tone])).toEqual([['cashOpening', 'neutral'], ['cashClosing', 'neutral'], ['cashDifference', 'success']])
    expect(reportKpiTiles(cashFlow(12), t, n).at(-1)?.tone).toBe('danger')
  })

  it('shows the net VAT of box 16: payable warns, a claim does not', () => {
    const report = (tax: number | null): LoadedReport => ({ slug: 'vat-return', data: { date_from: '2026-10-01', date_to: '2026-10-31', currency: 'SAR', status: 'draft_for_review', filed: false, boxes: [{ code: 'sa_16', number: 16, name: 'Net', base: null, tax }] } })
    expect(reportKpiTiles(report(750), t, n)[0]).toMatchObject({ id: 'netPayable', tone: 'warning' })
    expect(reportKpiTiles(report(-30), t, n)[0]?.tone).toBe('success')
    expect(reportKpiTiles(report(null), t, n)).toEqual([])
  })
})
