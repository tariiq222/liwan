import { describe, expect, it } from 'vitest'
import { reportFiltersFromQuery } from '../reportParams'
import { reportHeaderTags } from '../reportTags'

const t = (key: string, named?: Record<string, unknown>) => `${key}:${Object.values(named ?? {}).join('>')}`
const filters = reportFiltersFromQuery({}, '2026-10-20')

describe('report header tags', () => {
  it('names the period before the report arrives', () => {
    const tags = reportHeaderTags('trial-balance', filters, undefined, t)
    expect(tags.map(tag => [tag.kind, tag.label.replace(/[⁦⁩]/g, '')])).toEqual([['schedule', 'financeReports.tags.period:2026-10-01>2026-10-20']])
  })

  it('names a single day for balances as of a day', () => {
    expect(reportHeaderTags('aged-partner-balance', filters, undefined, t)[0]?.label).toContain('financeReports.tags.asOf')
  })

  it('adds the currency of the report and the partner of a statement', () => {
    const vat = { slug: 'vat' as const, data: { date_from: '2026-10-01', date_to: '2026-10-20', currency: 'SAR', sales: { taxes: [], base: 0, tax_amount: 0 }, purchases: { taxes: [], base: 0, tax_amount: 0 }, net_payable: 0 } }
    expect(reportHeaderTags('vat', filters, vat, t)[1]).toMatchObject({ kind: 'category', label: 'SAR' })
    const statement = { slug: 'partner-statement' as const, data: { type: 'activity' as const, kind: 'receivable' as const, partner: { id: 1, name: 'شركة' }, date_from: '2026-10-01', date_to: '2026-10-20', currencies: [] } }
    expect(reportHeaderTags('partner-statement', filters, statement, t)[1]).toMatchObject({ kind: 'person', label: 'شركة' })
  })

  it('names a single day for the balance sheet and the Zakat base', () => {
    expect(reportHeaderTags('balance-sheet', filters, undefined, t)[0]?.label).toContain('financeReports.tags.asOf')
    expect(reportHeaderTags('zakat-base', filters, undefined, t)[0]?.label).toContain('financeReports.tags.asOf')
    expect(reportHeaderTags('profit-loss', filters, undefined, t)[0]?.label).toContain('financeReports.tags.period')
  })

  it('names the budget period once loaded, and no period before that unless the URL gave a day', () => {
    expect(reportHeaderTags('budget-vs-actual', filters, undefined, t)).toEqual([])
    expect(reportHeaderTags('budget-vs-actual', reportFiltersFromQuery({ date_to: '2026-06-30' }, '2026-10-20'), undefined, t)[0]?.label).toContain('financeReports.tags.asOf')
    const side = { budget: 0, actual: 0, variance: 0, variance_percent: null }
    const loaded = { slug: 'budget-vs-actual' as const, data: { budget: { id: 1, name: 'x', state: 'confirmed' as const }, date_from: '2026-01-01', date_to: '2026-12-31', currency: 'SAR', target_move: 'posted' as const, lines: [], totals: { debit: side, credit: side, net: { budget: 0, actual: 0 } } } }
    const tags = reportHeaderTags('budget-vs-actual', filters, loaded, t)
    expect(tags.map(tag => [tag.kind, tag.label.replace(/[⁦⁩]/g, '')])).toEqual([['schedule', 'financeReports.tags.period:2026-01-01>2026-12-31'], ['category', 'SAR']])
  })
})
