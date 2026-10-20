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
})
