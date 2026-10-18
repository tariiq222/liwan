import { z } from 'zod'
import { currency, day, FinanceRefSchema, id, list } from './shared'

export { FinanceRefSchema }

export const FinanceMoveTypeSchema = z.enum([
  'out_invoice', 'out_refund', 'in_invoice', 'in_refund', 'out_receipt', 'in_receipt',
])
export const FinanceMoveStateSchema = z.enum(['draft', 'posted', 'cancel'])
export const FinancePaymentStateSchema = z.enum([
  'not_paid', 'in_payment', 'paid', 'partial', 'reversed', 'blocked', 'invoicing_legacy',
])

export const FinanceInvoiceSchema = z.object({
  id,
  name: z.string(),
  move_type: FinanceMoveTypeSchema,
  state: FinanceMoveStateSchema,
  payment_state: FinancePaymentStateSchema,
  partner: FinanceRefSchema.nullable(),
  journal: FinanceRefSchema,
  invoice_date: day.nullable(),
  invoice_date_due: day.nullable(),
  currency,
  amount_untaxed: z.number(),
  amount_tax: z.number(),
  amount_total: z.number(),
  amount_residual: z.number(),
}).strict()

export const FinanceInvoiceLineSchema = z.object({
  id,
  name: z.string(),
  account: FinanceRefSchema.nullable(),
  quantity: z.number(),
  price_unit: z.number(),
  discount: z.number(),
  taxes: z.array(FinanceRefSchema),
  price_subtotal: z.number(),
  price_total: z.number(),
}).strict()

/** ZATCA facts of a Saudi sale document; the QR payload is base64 TLV, null until the document is posted. */
export const FinanceInvoiceZatcaSchema = z.object({
  qr_code: z.string().min(1).nullable(),
  confirmation_datetime: z.string().datetime().nullable(),
}).strict()

export const FinanceInvoiceDetailSchema = FinanceInvoiceSchema.extend({
  ref: z.string(),
  debit_origin: FinanceRefSchema.nullable(),
  /** Null for every document that is not a Saudi sale document. */
  zatca: FinanceInvoiceZatcaSchema.nullable(),
  lines: z.array(FinanceInvoiceLineSchema),
}).strict()

export const FinancePaymentSchema = z.object({
  id,
  name: z.string(),
  payment_type: z.enum(['inbound', 'outbound']),
  partner_type: z.enum(['customer', 'supplier']),
  state: z.enum(['draft', 'in_process', 'paid', 'canceled', 'rejected']),
  partner: FinanceRefSchema.nullable(),
  journal: FinanceRefSchema,
  date: day,
  memo: z.string(),
  currency,
  amount: z.number(),
}).strict()

export const FinanceAccountTypeSchema = z.enum([
  'asset_receivable', 'asset_cash', 'asset_current', 'asset_non_current', 'asset_prepayments',
  'asset_fixed', 'liability_payable', 'liability_credit_card', 'liability_current',
  'liability_non_current', 'equity', 'equity_unaffected', 'income', 'income_other', 'expense',
  'expense_other', 'expense_depreciation', 'expense_direct_cost', 'off_balance',
])

export const FinanceAccountSchema = z.object({
  id,
  code: z.string(),
  name: z.string(),
  account_type: FinanceAccountTypeSchema,
  reconcile: z.boolean(),
  currency: currency.nullable(),
}).strict()

export const FinanceJournalSchema = z.object({
  id,
  name: z.string(),
  code: z.string(),
  type: z.enum(['sale', 'purchase', 'cash', 'bank', 'credit', 'general']),
  currency,
}).strict()

export const FinanceInvoiceListSchema = list(FinanceInvoiceSchema)
export const FinancePaymentListSchema = list(FinancePaymentSchema)
export const FinanceAccountListSchema = list(FinanceAccountSchema)
export const FinanceJournalListSchema = list(FinanceJournalSchema)

export type FinanceRef = z.infer<typeof FinanceRefSchema>
export type FinanceInvoice = z.infer<typeof FinanceInvoiceSchema>
export type FinanceInvoiceLine = z.infer<typeof FinanceInvoiceLineSchema>
export type FinanceInvoiceZatca = z.infer<typeof FinanceInvoiceZatcaSchema>
export type FinanceInvoiceDetail = z.infer<typeof FinanceInvoiceDetailSchema>
export type FinancePayment = z.infer<typeof FinancePaymentSchema>
export type FinanceAccount = z.infer<typeof FinanceAccountSchema>
export type FinanceJournal = z.infer<typeof FinanceJournalSchema>
export type FinanceInvoiceList = z.infer<typeof FinanceInvoiceListSchema>
export type FinancePaymentList = z.infer<typeof FinancePaymentListSchema>
export type FinanceAccountList = z.infer<typeof FinanceAccountListSchema>
export type FinanceJournalList = z.infer<typeof FinanceJournalListSchema>

export * from './assets'
export * from './bank'
export * from './journal-entries'
export * from './lookups'
export * from './partners'
export * from './report'
export * from './setup'
export * from './statements'
export * from './write'
