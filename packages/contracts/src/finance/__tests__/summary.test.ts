import { describe, expect, it } from 'vitest'
import { FinanceInvoiceSummarySchema, FinanceEntrySummarySchema, FinanceAssetSummarySchema, FinanceBudgetSummarySchema } from '../summary'

describe('strict finance summary contracts', () => {
  it.each([
    [FinanceInvoiceSummarySchema, { total: 3, draft: 1, posted: 1, cancel: 1 }],
    [FinanceEntrySummarySchema, { total: 3, draft: 1, posted: 1, cancel: 1 }],
    [FinanceAssetSummarySchema, { total: 4, draft: 1, open: 1, close: 1 }],
    [FinanceBudgetSummarySchema, { total: 3, draft: 1, confirmed: 1, cancelled: 1 }],
  ])('accepts nonnegative integer counts only with exactly the whitelisted keys', (schema, body) => {
    expect(schema.safeParse(body).success).toBe(true)
    expect(schema.safeParse(Object.fromEntries(Object.keys(body).map(key => [key, 0]))).success).toBe(true)
    for (const total of [-1, 1.5, '3', null]) expect(schema.safeParse({ ...body, total }).success).toBe(false)
    expect(schema.safeParse({ ...body, items: [] }).success).toBe(false)
    const { draft: _draft, ...missing } = body
    expect(schema.safeParse(missing).success).toBe(false)
  })
})
