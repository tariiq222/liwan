import { describe, expect, it } from 'vitest'
import { FinanceInvoiceSummarySchema, FinanceEntrySummarySchema, FinanceAssetSummarySchema, FinanceBudgetSummarySchema } from '@liwan/contracts'
import { moduleUiPreviewData } from '../../../e2e/module-ui-preview-data.mjs'

const get = (resource, suffix = '', params = {}) => {
  const path = `/api/v1/finance/${resource}${suffix}`
  return moduleUiPreviewData(path, new URL(`http://localhost${path}?${new URLSearchParams(params)}`))
}
const resources = [
  ['invoices', FinanceInvoiceSummarySchema, ['draft', 'posted', 'cancel'], { move_type: 'out_invoice', partner_id: '1', date_from: '2026-09-01', date_to: '2026-10-31' }],
  ['entries', FinanceEntrySummarySchema, ['draft', 'posted', 'cancel'], { journal_id: '5', date_from: '2026-09-01', date_to: '2026-10-31' }],
  ['assets', FinanceAssetSummarySchema, ['draft', 'open', 'close'], { profile_id: '1' }],
  ['budgets', FinanceBudgetSummarySchema, ['draft', 'confirmed', 'cancelled'], { q: '2026' }],
]

describe('finance summary preview routes', () => {
  it.each(resources)('%s summary matches all filtered list totals regardless of selected state or page', (resource, schema, states, filters) => {
    for (const query of [{}, filters, { q: 'no-such-summary-record' }]) {
      const expected = { total: get(resource, '', query).total }
      for (const state of states) expected[state] = get(resource, '', { ...query, state }).total
      const summary = get(resource, '/summary', { ...query, state: states[0], limit: '1', offset: '100' })
      expect(schema.parse(summary)).toEqual(expected)
    }
  })
  it('includes disposed assets in total without creating an extra tile key', () => {
    const summary = get('assets', '/summary')
    const removed = get('assets', '', { state: 'removed' }).total
    expect(removed).toBeGreaterThan(0)
    expect(summary.total).toBe(summary.draft + summary.open + summary.close + removed)
    expect(summary).not.toHaveProperty('removed')
  })
})
