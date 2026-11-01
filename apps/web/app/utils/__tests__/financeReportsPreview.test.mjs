import { describe, expect, it } from 'vitest'
import { FinanceCashFlowSchema, FinanceZatcaWaitingDocumentListSchema } from '@liwan/contracts'
import { moduleUiPreviewData } from '../../../e2e/module-ui-preview-data.mjs'

const read = (path, query = '') => moduleUiPreviewData(path, new URL(`http://localhost${path}${query}`))

describe('synthetic finance preview matches production read contracts', () => {
  it('serves the cash-flow statement and it closes', () => {
    const report = FinanceCashFlowSchema.parse(read('/api/v1/finance/reports/cash-flow'))
    expect(report.difference).toBe(0)
    expect(report.opening_cash + report.net_change).toBe(report.closing_cash)
    expect(report.operating.total + report.investing.total + report.financing.total).toBe(report.total_change)
  })

  it('serves the ZATCA waiting documents, narrowed by state', () => {
    const all = FinanceZatcaWaitingDocumentListSchema.parse(read('/api/v1/finance/zatca/documents'))
    expect(all.items.map(row => row.submission.state)).toEqual(['pending', 'retry', 'rejected', 'blocked'])
    const rejected = FinanceZatcaWaitingDocumentListSchema.parse(read('/api/v1/finance/zatca/documents', '?state=rejected'))
    expect(rejected.items).toHaveLength(1)
  })
})
