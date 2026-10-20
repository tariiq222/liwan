import { z } from 'zod'
import { FinanceAnalyticShareSchema } from './analytic'
import { currency, day, FinanceRefSchema, id, list } from './shared'
import { FinanceZatcaSubmissionSchema } from './zatca'

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
  /** Null until a number is assigned. */
  name: z.string().nullable(),
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
  analytic_distribution: z.array(FinanceAnalyticShareSchema),
}).strict()

/** ZATCA facts of a Saudi sale document; the QR payload is base64 TLV, null until the document is posted. */
export const FinanceInvoiceZatcaSchema = z.object({
  qr_code: z.string().min(1).nullable(),
  confirmation_datetime: z.string().datetime().nullable(),
  submission: FinanceZatcaSubmissionSchema,
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
  /** Null until a number is assigned. */
  name: z.string().nullable(),
  payment_type: z.enum(['inbound', 'outbound']),
  partner_type: z.enum(['customer', 'supplier']),
  state: z.enum(['draft', 'in_process', 'paid', 'canceled', 'rejected']),
  partner: FinanceRefSchema.nullable(),
  journal: FinanceRefSchema,
  date: day,
  memo: z.string(),
  currency,
  amount: z.number(),
  /** What a posted payment still holds open on the partner's account (an advance, an overpayment); zero otherwise. */
  unallocated: z.number(),
  /** The invoices it is set against now. */
  invoices: z.array(FinanceRefSchema),
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
  active: z.boolean(),
}).strict()

export const FinanceJournalSchema = z.object({
  id,
  name: z.string(),
  code: z.string(),
  type: z.enum(['sale', 'purchase', 'cash', 'bank', 'credit', 'general']),
  currency,
  default_account: FinanceRefSchema.nullable(),
  active: z.boolean(),
}).strict()

export const FinanceTaxSchema = z.object({
  id,
  name: z.string(),
  type_tax_use: z.enum(['sale', 'purchase']),
  amount_type: z.enum(['percent', 'fixed']),
  amount: z.number(),
  price_include: z.boolean(),
  /** Where the tax amount is booked; `null` when it follows the base line's account. */
  tax_account: FinanceRefSchema.nullable(),
  active: z.boolean(),
  /** True once journal items use it: its rate, kind and price-include setting are then fixed. */
  used: z.boolean(),
}).strict()

export const FinancePaymentTermLineSchema = z.object({
  value: z.enum(['percent', 'fixed']),
  value_amount: z.number(),
  nb_days: z.number().int(),
  delay_type: z.enum(['days_after', 'days_after_end_of_month', 'days_after_end_of_next_month', 'days_end_of_month_on_the']),
}).strict()

export const FinancePaymentTermSchema = z.object({
  id,
  name: z.string(),
  /** True for a term shared by every company (it comes with the chart): it is read-only here. */
  shared: z.boolean(),
  active: z.boolean(),
  lines: z.array(FinancePaymentTermLineSchema),
}).strict()

export const FinanceInvoiceListSchema = list(FinanceInvoiceSchema)
export const FinancePaymentListSchema = list(FinancePaymentSchema)
export const FinanceAccountListSchema = list(FinanceAccountSchema)
export const FinanceJournalListSchema = list(FinanceJournalSchema)
export const FinanceTaxListSchema = list(FinanceTaxSchema)
export const FinancePaymentTermListSchema = list(FinancePaymentTermSchema)

export type FinanceRef = z.infer<typeof FinanceRefSchema>
export type FinanceInvoice = z.infer<typeof FinanceInvoiceSchema>
export type FinanceInvoiceLine = z.infer<typeof FinanceInvoiceLineSchema>
export type FinanceInvoiceZatca = z.infer<typeof FinanceInvoiceZatcaSchema>
export type FinanceInvoiceDetail = z.infer<typeof FinanceInvoiceDetailSchema>
export type FinancePayment = z.infer<typeof FinancePaymentSchema>
export type FinanceAccount = z.infer<typeof FinanceAccountSchema>
export type FinanceJournal = z.infer<typeof FinanceJournalSchema>
export type FinanceTax = z.infer<typeof FinanceTaxSchema>
export type FinancePaymentTerm = z.infer<typeof FinancePaymentTermSchema>
export type FinancePaymentTermLine = z.infer<typeof FinancePaymentTermLineSchema>
export type FinanceInvoiceList = z.infer<typeof FinanceInvoiceListSchema>
export type FinancePaymentList = z.infer<typeof FinancePaymentListSchema>
export type FinanceAccountList = z.infer<typeof FinanceAccountListSchema>
export type FinanceJournalList = z.infer<typeof FinanceJournalListSchema>
export type FinanceTaxList = z.infer<typeof FinanceTaxListSchema>
export type FinancePaymentTermList = z.infer<typeof FinancePaymentTermListSchema>

export * from './analytic'
export * from './assets'
export * from './audit'
export * from './bank'
export * from './budgets'
export * from './closing'
export * from './journal-entries'
export * from './lookups'
export * from './partners'
export * from './report'
export * from './setup'
export * from './statements'
export * from './write'
export * from './zatca'
