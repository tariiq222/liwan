import { describe, expect, it } from 'vitest'
import { REPORT_SLUGS, REPORTS, reportCurrency, reportSlug, type LoadedReport } from '../reportConfig'

describe('the report config', () => {
  it('knows the thirteen reports and refuses any other slug', () => {
    expect(REPORT_SLUGS).toHaveLength(13)
    expect(reportSlug('vat')).toBe('vat')
    expect(reportSlug(['withholding', 'x'])).toBe('withholding')
    expect(reportSlug('profit-loss')).toBe('profit-loss')
    expect(reportSlug('income')).toBeNull()
    expect(reportSlug(undefined)).toBeNull()
  })

  it('gates the statements and the tax reports by their own capability', () => {
    expect(Object.entries(REPORTS).filter(([, config]) => config.capability === 'finance.reports.read').map(([slug]) => slug)).toEqual(['vat', 'withholding', 'vat-return'])
    expect(REPORTS.analytic.capability).toBe('finance.analytic.read')
    for (const slug of REPORT_SLUGS) expect(REPORTS[slug].capability).toMatch(/^finance\.(statements|reports|analytic|zakat|budgets)\.read$/)
  })

  it('gates the four newer reports by the capabilities the manifest names', () => {
    expect(REPORTS['profit-loss'].capability).toBe('finance.statements.read')
    expect(REPORTS['balance-sheet'].capability).toBe('finance.statements.read')
    expect(REPORTS['zakat-base'].capability).toBe('finance.zakat.read')
    expect(REPORTS['budget-vs-actual'].capability).toBe('finance.budgets.read')
  })

  it('takes the posting filter for the statements and the budget only for the budget comparison', () => {
    expect(REPORT_SLUGS.filter(slug => REPORTS[slug].filters.budget)).toEqual(['budget-vs-actual'])
    expect(REPORTS['profit-loss'].filters).toMatchObject({ period: 'range', targetMove: true })
    expect(REPORTS['balance-sheet'].filters).toMatchObject({ period: 'end', targetMove: true })
    expect(REPORTS['zakat-base'].filters).toMatchObject({ period: 'end', targetMove: true })
    expect(REPORTS['budget-vs-actual'].filters).toMatchObject({ period: 'end', targetMove: false })
  })

  it('takes the plan filter for the cost center report alone', () => {
    expect(REPORT_SLUGS.filter(slug => REPORTS[slug].filters.plan)).toEqual(['analytic'])
  })

  it('tags a parsed report with its slug', () => {
    const vat = { date_from: '2026-10-01', date_to: '2026-10-20', currency: 'SAR', sales: { taxes: [], base: 0, tax_amount: 0 }, purchases: { taxes: [], base: 0, tax_amount: 0 }, net_payable: 0 }
    const loaded = REPORTS.vat.schema.parse(vat)
    expect(loaded).toEqual({ slug: 'vat', data: vat })
    expect(reportCurrency(loaded)).toBe('SAR')
    expect(() => REPORTS.vat.schema.parse({ ...vat, extra: 1 })).toThrow()
  })

  it('tags the MIS and budget reports with their slug and company currency', () => {
    const lines = [{ code: 'revenue', label: 'Revenue', value: 5 }]
    const statement = { target_move: 'posted', currency: 'SAR', statutory: false, status: 'management_information', lines }
    const profit = { date_from: '2026-10-01', date_to: '2026-10-20', ...statement }
    expect(REPORTS['profit-loss'].schema.parse(profit)).toEqual({ slug: 'profit-loss', data: profit })
    expect(() => REPORTS['balance-sheet'].schema.parse({ ...profit, extra: 1 })).toThrow()
    const loaded = REPORTS['balance-sheet'].schema.parse({ date_to: '2026-10-20', ...statement, target_move: 'all' })
    expect(reportCurrency(loaded)).toBe('SAR')
  })

  it('marks only the income statement and the balance sheet as management information', () => {
    expect(REPORT_SLUGS.filter(slug => REPORTS[slug].managementInformation)).toEqual(['profit-loss', 'balance-sheet'])
  })

  it('has no single currency for a partner statement', () => {
    const loaded: LoadedReport = { slug: 'partner-statement', data: { type: 'activity', kind: 'receivable', partner: { id: 1, name: 'x' }, date_from: '2026-10-01', date_to: '2026-10-20', currencies: [] } }
    expect(reportCurrency(loaded)).toBeNull()
  })

  it('reads the cash flow statement and the VAT return for a period, with the capability the API checks', () => {
    expect(REPORTS['cash-flow'].capability).toBe('finance.statements.read')
    expect(REPORTS['vat-return'].capability).toBe('finance.reports.read')
    for (const slug of ['cash-flow', 'vat-return'] as const) expect(REPORTS[slug].filters).toMatchObject({ period: 'range', targetMove: false })
  })

  it('tags a VAT return with its slug and refuses a return that claims to be filed', () => {
    const vatReturn = { date_from: '2026-10-01', date_to: '2026-10-31', currency: 'SAR', status: 'draft_for_review', filed: false, boxes: [{ code: 'sa_1', number: 1, name: 'x', base: 100, tax: 15 }] }
    expect(REPORTS['vat-return'].schema.parse(vatReturn)).toEqual({ slug: 'vat-return', data: vatReturn })
    expect(() => REPORTS['vat-return'].schema.parse({ ...vatReturn, filed: true })).toThrow()
  })
})
