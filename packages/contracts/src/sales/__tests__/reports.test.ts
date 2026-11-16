import { describe, expect, it } from 'vitest'
import {
  SALES_REPORT_EXPORT_COLUMNS,
  SalesReportBreakdownSchema,
  SalesReportItemSchema,
  SalesReportSummarySchema,
} from '../index'

const CURRENCY = { id: 2, name: 'SAR', symbol: 'ر.س' }
const TOTALS = { orders: 3, amount_untaxed: 310, amount_total: 310 }
const ITEM = { key: 7, label: 'مؤسسة النخيل', orders: 1, quantity: null, amount_untaxed: 100, amount_total: 115 }

describe('the sales report summary', () => {
  const summary = { currency: CURRENCY, confirmed: TOTALS, quotations: { orders: 0, amount_untaxed: 0, amount_total: 0 }, cancelled: TOTALS }

  it('carries the three state groups in the company currency and nothing else', () => {
    expect(SalesReportSummarySchema.parse(summary)).toEqual(summary)
    expect(SalesReportSummarySchema.safeParse({ ...summary, extra: 1 }).success).toBe(false)
    expect(SalesReportSummarySchema.safeParse({ ...summary, cancelled: undefined }).success).toBe(false)
    expect(SalesReportSummarySchema.safeParse({ ...summary, confirmed: { ...TOTALS, orders: 1.5 } }).success).toBe(false)
  })
})

describe('a sales report group', () => {
  it('is keyed by an id or an ISO day, and by null for the orders nobody owns', () => {
    expect(SalesReportItemSchema.parse(ITEM)).toEqual(ITEM)
    expect(SalesReportItemSchema.parse({ ...ITEM, key: '2026-01-01', label: '2026-01-01' }).key).toBe('2026-01-01')
    expect(SalesReportItemSchema.parse({ ...ITEM, key: null, label: null }).key).toBeNull()
    expect(SalesReportItemSchema.safeParse({ ...ITEM, key: 0 }).success).toBe(false)
    expect(SalesReportItemSchema.safeParse({ ...ITEM, orders: -1 }).success).toBe(false)
    expect(SalesReportItemSchema.safeParse({ ...ITEM, cost: 1 }).success).toBe(false)
  })
})

describe('a sales report breakdown', () => {
  const breakdown = { by: 'product', period: null, currency: CURRENCY, items: [{ ...ITEM, quantity: 3 }], total: 1 }

  it('names its dimension and the period size of a period breakdown', () => {
    expect(SalesReportBreakdownSchema.parse(breakdown)).toEqual(breakdown)
    expect(SalesReportBreakdownSchema.parse({ ...breakdown, by: 'period', period: 'week' }).period).toBe('week')
    expect(SalesReportBreakdownSchema.safeParse({ ...breakdown, by: 'team' }).success).toBe(false)
    expect(SalesReportBreakdownSchema.safeParse({ ...breakdown, period: 'year' }).success).toBe(false)
  })
})

describe('the export columns', () => {
  it('match the header the server writes', () => {
    expect(SALES_REPORT_EXPORT_COLUMNS).toEqual([
      'number', 'date', 'state', 'source', 'customer', 'salesperson', 'product', 'quantity', 'unit_price',
      'discount_percent', 'amount_untaxed', 'amount_total', 'currency',
    ])
  })
})
