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
}).strict()

// A body that carries `lines` replaces every line of the draft; one without keeps them.
const lines = z.array(FinanceInvoiceLineInputSchema).min(1)

export const FinanceInvoiceCreateSchema = z.object({
  move_type: FinanceWritableMoveTypeSchema,
  partner_id: id,
  lines,
  invoice_date: day.nullable().optional(),
  invoice_date_due: day.nullable().optional(),
  currency: z.string().min(1).optional(),
  ref: text.optional(),
}).strict()

export const FinanceInvoicePatchSchema = FinanceInvoiceCreateSchema.omit({ move_type: true }).partial().strict()
  .refine(requirePatchField, PATCH_MESSAGE)

export const FinancePaymentRegisterSchema = z.object({
  invoice_ids: z.array(id).min(1),
  amount: money.positive(),
  payment_date: day,
  journal_id: id,
  payment_method_line_id: id.optional(),
  memo: text.optional(),
}).strict()

export type FinanceInvoiceLineInput = z.infer<typeof FinanceInvoiceLineInputSchema>
export type FinanceInvoiceCreate = z.infer<typeof FinanceInvoiceCreateSchema>
export type FinanceInvoicePatch = z.infer<typeof FinanceInvoicePatchSchema>
export type FinancePaymentRegister = z.infer<typeof FinancePaymentRegisterSchema>
