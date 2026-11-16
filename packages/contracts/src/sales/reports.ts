import { z } from 'zod'

// liwan_sales reports and export (`sales.reports.read`): orders and amounts from stock's sales analysis, read only.
// Field for field with odoo-addons/liwan_sales/serializers/reports.py. Every figure counts the documents the caller
// reads under the tenant's visibility setting, in the working company, in the company currency; the lines stock adds
// for a down payment are never counted.

const Count = z.number().int().nonnegative()
const Amount = z.number()

/** The company currency every amount of a report is in. */
export const SalesReportCurrencySchema = z.object({
  id: z.number().int().positive(),
  name: z.string().min(1),
  symbol: z.string(),
}).strict()

/** The orders and amounts of one state group. */
export const SalesReportTotalsSchema = z.object({
  orders: Count,
  amount_untaxed: Amount,
  amount_total: Amount,
}).strict()

/** `GET /sales/reports/summary`: confirmed orders, open quotations (draft and sent) and cancelled documents, side by side. */
export const SalesReportSummarySchema = z.object({
  currency: SalesReportCurrencySchema,
  confirmed: SalesReportTotalsSchema,
  quotations: SalesReportTotalsSchema,
  cancelled: SalesReportTotalsSchema,
}).strict()

export const SALES_REPORT_DIMENSIONS = ['period', 'salesperson', 'customer', 'product'] as const
export const SalesReportDimensionSchema = z.enum(SALES_REPORT_DIMENSIONS)
export const SALES_REPORT_PERIODS = ['day', 'week', 'month'] as const
export const SalesReportPeriodSchema = z.enum(SALES_REPORT_PERIODS)

/**
 * One group of a breakdown. `key` is a record id for a salesperson, customer or product, or the ISO day a period starts
 * on; it and `label` are null for the orders nobody owns (the online ones) under `salesperson`. `quantity` is given for
 * the product dimension only.
 */
export const SalesReportItemSchema = z.object({
  key: z.union([z.number().int().positive(), z.string().min(1)]).nullable(),
  label: z.string().nullable(),
  orders: Count,
  quantity: z.number().nullable(),
  amount_untaxed: Amount,
  amount_total: Amount,
}).strict()

/** `GET /sales/reports/breakdown`: one page of the groups, `total` counting every group. A period comes oldest first, the rest largest first. */
export const SalesReportBreakdownSchema = z.object({
  by: SalesReportDimensionSchema,
  // The period size of the `period` dimension; null for the others.
  period: SalesReportPeriodSchema.nullable(),
  currency: SalesReportCurrencySchema,
  items: z.array(SalesReportItemSchema),
  total: Count,
}).strict()

/** The columns of the CSV export, in order. */
export const SALES_REPORT_EXPORT_COLUMNS = [
  'number', 'date', 'state', 'source', 'customer', 'salesperson', 'product', 'quantity', 'unit_price',
  'discount_percent', 'amount_untaxed', 'amount_total', 'currency',
] as const

export type SalesReportCurrency = z.infer<typeof SalesReportCurrencySchema>
export type SalesReportTotals = z.infer<typeof SalesReportTotalsSchema>
export type SalesReportSummary = z.infer<typeof SalesReportSummarySchema>
export type SalesReportDimension = z.infer<typeof SalesReportDimensionSchema>
export type SalesReportPeriod = z.infer<typeof SalesReportPeriodSchema>
export type SalesReportItem = z.infer<typeof SalesReportItemSchema>
export type SalesReportBreakdown = z.infer<typeof SalesReportBreakdownSchema>
