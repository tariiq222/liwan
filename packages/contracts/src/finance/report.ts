import { z } from 'zod'
import { currency, FinanceRefSchema, list } from './shared'

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

/**
 * GET /finance/reports/vat-return?date_from&date_to: the 16 boxes of the Saudi VAT return from the tax tags of the posted
 * journal items. A box has a `base` and/or a `tax` column (the other is null). It is a draft for the taxpayer's review and
 * is never filed by WebVue: `filed` is always false.
 */
export const FinanceVatReturnSchema = z.object({
  date_from: day,
  date_to: day,
  currency,
  status: z.literal('draft_for_review'),
  filed: z.literal(false),
  boxes: z.array(z.object({
    code: z.string().regex(/^sa_\d{1,2}$/),
    number: z.number().int().min(1).max(16),
    name: z.string(),
    base: z.number().nullable(),
    tax: z.number().nullable(),
  }).strict()),
}).strict()

/** GET /finance/reports/vat-return/items?code&column: the journal items behind one column of one box. */
export const FinanceVatReturnItemSchema = z.object({
  id,
  date: day,
  entry: FinanceRefSchema.nullable(),
  entry_type: z.string(),
  account: z.object({ id, code: z.string(), name: z.string() }).strict(),
  partner: FinanceRefSchema.nullable(),
  label: z.string(),
  /** The item's balance in the company currency. */
  balance: z.number(),
  /** Its contribution to the box column (positive when it adds to the box). */
  amount: z.number(),
}).strict()
export const FinanceVatReturnItemListSchema = list(FinanceVatReturnItemSchema)

export type FinanceVatReturn = z.infer<typeof FinanceVatReturnSchema>
export type FinanceVatReturnItem = z.infer<typeof FinanceVatReturnItemSchema>
