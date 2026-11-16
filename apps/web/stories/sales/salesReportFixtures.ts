import type { SalesReportBreakdown } from '@liwan/contracts'
import { parseSalesReportQuery } from '../../app/composables/sales/salesReportParams'

// The wire shapes of the sales report stories: a breakdown by customer in the company currency and the page state it answers.
const currency = { id: 2, name: 'SAR', symbol: 'ر.س' }
export const defaultReportState = parseSalesReportQuery({})
export const customerReportState = parseSalesReportQuery({ by: 'customer' })
export const productReportState = parseSalesReportQuery({ by: 'product' })
export const pickedReportState = parseSalesReportQuery({ by: 'customer', from: '2026-11-01', to: '2026-11-30', source: 'staff', state: 'all', salesperson: '7' })

export const customerBreakdown: SalesReportBreakdown = {
  by: 'customer', period: null, currency, total: 3, items: [
    { key: 2, label: 'مؤسسة النخيل', orders: 4, quantity: null, amount_untaxed: 2160, amount_total: 2484 },
    { key: 1, label: 'منى العتيبي', orders: 2, quantity: null, amount_untaxed: 540, amount_total: 621 },
    { key: 3, label: 'خالد الشهري', orders: 1, quantity: null, amount_untaxed: 120, amount_total: 138 },
  ],
}
export const productBreakdown: SalesReportBreakdown = {
  ...customerBreakdown, by: 'product', items: [
    { key: 1, label: 'باقة أساسية', orders: 5, quantity: 12, amount_untaxed: 1440, amount_total: 1656 },
    { key: 202, label: 'عسل سدر', orders: 2, quantity: 6, amount_untaxed: 900, amount_total: 1035 },
    { key: 2, label: 'باقة متقدمة', orders: 1, quantity: 1, amount_untaxed: 480, amount_total: 552 },
  ],
}
export const periodBreakdown: SalesReportBreakdown = {
  by: 'period', period: 'month', currency, total: 2, items: [
    { key: '2026-10-01', label: '2026-10-01', orders: 3, quantity: null, amount_untaxed: 900, amount_total: 1035 },
    { key: '2026-11-01', label: '2026-11-01', orders: 4, quantity: null, amount_untaxed: 1920, amount_total: 2208 },
  ],
}
export const salespersonBreakdown: SalesReportBreakdown = {
  by: 'salesperson', period: null, currency, total: 2, items: [
    { key: 7, label: 'مها الثبيتي', orders: 3, quantity: null, amount_untaxed: 1620, amount_total: 1863 },
    { key: null, label: null, orders: 1, quantity: null, amount_untaxed: 300, amount_total: 345 },
  ],
}
