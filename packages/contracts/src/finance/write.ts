import { z } from 'zod'
import { FinanceAnalyticDistributionInputSchema } from './analytic'
import { day, id, money, PATCH_MESSAGE, requirePatchField, text } from './shared'

export const FinanceWritableMoveTypeSchema = z.enum(['out_invoice', 'in_invoice', 'out_refund', 'in_refund'])

export const FinanceInvoiceLineInputSchema = z.object({
  name: text.trim().min(1),
  price_unit: money,
  quantity: money.nonnegative().optional(),
  discount: z.number().min(0).max(100).optional(),
  // Omitted: the account's default taxes apply. An empty list: no tax.
  tax_ids: z.array(id).optional(),
  account_id: id.optional(),
  analytic_distribution: FinanceAnalyticDistributionInputSchema.optional(),
  // Vendor bills only: posting the bill creates a draft asset on this profile.
  asset_profile_id: id.optional(),
}).strict()

// A body that carries `lines` replaces every line of the draft; one without keeps them.
const lines = z.array(FinanceInvoiceLineInputSchema).min(1)

export const FinanceInvoiceCreateSchema = z.object({
  move_type: FinanceWritableMoveTypeSchema,
  partner_id: id,
  /** Chosen at creation only; it defaults to the company's first journal of the document's kind. */
  journal_id: id.optional(),
  lines,
  invoice_date: day.nullable().optional(),
  invoice_date_due: day.nullable().optional(),
  /** Derives the due date from the invoice date unless `invoice_date_due` is also sent; null clears the term. */
  payment_term_id: id.nullable().optional(),
  currency: z.string().min(1).optional(),
  ref: text.optional(),
}).strict()

export const FinanceInvoicePatchSchema = FinanceInvoiceCreateSchema.omit({ move_type: true, journal_id: true }).partial().strict()
  .refine(requirePatchField, PATCH_MESSAGE)

export const FinancePaymentRegisterSchema = z.object({
  invoice_ids: z.array(id).min(1),
  amount: money.positive(),
  payment_date: day,
  journal_id: id,
  payment_method_line_id: id.optional(),
  memo: text.optional(),
}).strict()

/** A receipt (`inbound`) or payment (`outbound`) that names no invoice: an advance, or money to allocate later. */
export const FinancePaymentStandaloneSchema = z.object({
  payment_type: z.enum(['inbound', 'outbound']),
  /** Defaults to the customer for a receipt and the vendor for a payment; a refund of a customer advance is an outbound payment to a customer. */
  partner_type: z.enum(['customer', 'supplier']).optional(),
  partner_id: id,
  amount: money.positive(),
  payment_date: day,
  journal_id: id,
  payment_method_line_id: id.optional(),
  memo: text.optional(),
}).strict()

/** Money moved between two bank or cash journals through the company's transfer account. */
export const FinancePaymentTransferSchema = z.object({
  from_journal_id: id,
  to_journal_id: id,
  amount: money.positive(),
  payment_date: day,
  memo: text.optional(),
}).strict()

/** Only a draft payment is edited (for example after a reset to draft). */
export const FinancePaymentPatchSchema = FinancePaymentStandaloneSchema.omit({ payment_type: true, partner_type: true, partner_id: true }).partial().strict()
  .refine(requirePatchField, PATCH_MESSAGE)

/** Exactly one non-empty list: the invoices, or the payments (a refund), the payment is set against. */
export const FinancePaymentAllocateSchema = z.object({
  invoice_ids: z.array(id).min(1).optional(),
  payment_ids: z.array(id).min(1).optional(),
}).strict().refine(body => Number(!!body.invoice_ids) + Number(!!body.payment_ids) === 1, 'give either invoice_ids or payment_ids')

export type FinanceInvoiceLineInput = z.infer<typeof FinanceInvoiceLineInputSchema>
export type FinanceInvoiceCreate = z.infer<typeof FinanceInvoiceCreateSchema>
export type FinanceInvoicePatch = z.infer<typeof FinanceInvoicePatchSchema>
export type FinancePaymentRegister = z.infer<typeof FinancePaymentRegisterSchema>
export type FinancePaymentTransfer = z.infer<typeof FinancePaymentTransferSchema>
export type FinancePaymentStandalone = z.infer<typeof FinancePaymentStandaloneSchema>
export type FinancePaymentPatch = z.infer<typeof FinancePaymentPatchSchema>
export type FinancePaymentAllocate = z.infer<typeof FinancePaymentAllocateSchema>
