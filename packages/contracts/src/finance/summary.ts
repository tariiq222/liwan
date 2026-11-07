import { z } from 'zod'

const count = z.number().int().nonnegative()

/** Counts for the list's filters, with selected state and pagination excluded. */
export const FinanceInvoiceSummarySchema = z.object({ total: count, draft: count, posted: count, cancel: count }).strict()
export const FinanceEntrySummarySchema = z.object({ total: count, draft: count, posted: count, cancel: count }).strict()
/** Total includes disposed assets (`removed`), even though there is no disposed tile. */
export const FinanceAssetSummarySchema = z.object({ total: count, draft: count, open: count, close: count }).strict()
export const FinanceBudgetSummarySchema = z.object({ total: count, draft: count, confirmed: count, cancelled: count }).strict()

export type FinanceInvoiceSummary = z.infer<typeof FinanceInvoiceSummarySchema>
export type FinanceEntrySummary = z.infer<typeof FinanceEntrySummarySchema>
export type FinanceAssetSummary = z.infer<typeof FinanceAssetSummarySchema>
export type FinanceBudgetSummary = z.infer<typeof FinanceBudgetSummarySchema>
