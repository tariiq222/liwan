import { z } from 'zod'

const id = z.number().int().positive()
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)

const TaxRefSchema = z.object({ id, name: z.string() }).strict()

export const FinanceVatTaxRowSchema = z.object({
  tax: TaxRefSchema,
  /** The percentage of a percent tax; null for fixed and group taxes. */
  rate: z.number().nullable(),
  base: z.number(),
  tax_amount: z.number(),
}).strict()

export const FinanceVatSectionSchema = z.object({
  taxes: z.array(FinanceVatTaxRowSchema),
  base: z.number(),
  tax_amount: z.number(),
}).strict()

/** Output VAT on sales minus input VAT on purchases for a period; negative means a refund position. */
export const FinanceVatSummarySchema = z.object({
  date_from: day,
  date_to: day,
  currency: z.string().min(1),
  sales: FinanceVatSectionSchema,
  purchases: FinanceVatSectionSchema,
  net_payable: z.number(),
}).strict()

export type FinanceVatTaxRow = z.infer<typeof FinanceVatTaxRowSchema>
export type FinanceVatSection = z.infer<typeof FinanceVatSectionSchema>
export type FinanceVatSummary = z.infer<typeof FinanceVatSummarySchema>

export const FinanceWithholdingTaxRowSchema = z.object({
  tax: TaxRefSchema,
  /** The withholding percentage (always positive); null for fixed and group taxes. */
  rate: z.number().nullable(),
  base: z.number(),
  withheld: z.number(),
}).strict()

/** Tax withheld from vendor payments in a period, per withholding tax, in the company currency. */
export const FinanceWithholdingSummarySchema = z.object({
  date_from: day,
  date_to: day,
  currency: z.string().min(1),
  taxes: z.array(FinanceWithholdingTaxRowSchema),
  base: z.number(),
  withheld: z.number(),
}).strict()

export type FinanceWithholdingTaxRow = z.infer<typeof FinanceWithholdingTaxRowSchema>
export type FinanceWithholdingSummary = z.infer<typeof FinanceWithholdingSummarySchema>
