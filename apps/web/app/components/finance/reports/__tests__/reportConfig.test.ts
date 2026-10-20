import { describe, expect, it } from 'vitest'
import { REPORT_SLUGS, REPORTS, reportCurrency, reportSlug, type LoadedReport } from '../reportConfig'

describe('the report config', () => {
  it('knows the six reports and refuses any other slug', () => {
    expect(REPORT_SLUGS).toHaveLength(6)
    expect(reportSlug('vat')).toBe('vat')
    expect(reportSlug(['withholding', 'x'])).toBe('withholding')
    expect(reportSlug('profit-loss')).toBeNull()
    expect(reportSlug(undefined)).toBeNull()
  })

  it('gates the statements and the tax reports by their own capability', () => {
    expect(Object.entries(REPORTS).filter(([, config]) => config.capability === 'finance.reports.read').map(([slug]) => slug)).toEqual(['vat', 'withholding'])
    for (const slug of REPORT_SLUGS) expect(REPORTS[slug].capability).toMatch(/^finance\.(statements|reports)\.read$/)
  })

  it('tags a parsed report with its slug', () => {
    const vat = { date_from: '2026-10-01', date_to: '2026-10-20', currency: 'SAR', sales: { taxes: [], base: 0, tax_amount: 0 }, purchases: { taxes: [], base: 0, tax_amount: 0 }, net_payable: 0 }
    const loaded = REPORTS.vat.schema.parse(vat)
    expect(loaded).toEqual({ slug: 'vat', data: vat })
    expect(reportCurrency(loaded)).toBe('SAR')
    expect(() => REPORTS.vat.schema.parse({ ...vat, extra: 1 })).toThrow()
  })

  it('has no single currency for a partner statement', () => {
    const loaded: LoadedReport = { slug: 'partner-statement', data: { type: 'activity', kind: 'receivable', partner: { id: 1, name: 'x' }, date_from: '2026-10-01', date_to: '2026-10-20', currencies: [] } }
    expect(reportCurrency(loaded)).toBeNull()
  })
})
