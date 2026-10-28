import { z } from 'zod'
import { FinanceAnalyticShareSchema } from './analytic'
import { currency, day, FinanceActionBlockReasonSchema, FinanceRefSchema, financeActions, id, list, money, PATCH_MESSAGE, requirePatchField, text } from './shared'
import { FinanceZatcaSubmissionSchema } from './zatca'

export { FinanceActionBlockReasonSchema, FinanceRefSchema }

export const FinanceMoveTypeSchema = z.enum([
  'out_invoice', 'out_refund', 'in_invoice', 'in_refund', 'out_receipt', 'in_receipt',
])
export const FinanceMoveStateSchema = z.enum(['draft', 'posted', 'cancel'])
export const FinancePaymentStateSchema = z.enum([
  'not_paid', 'in_payment', 'paid', 'partial', 'reversed', 'blocked', 'invoicing_legacy',
])

export const FinanceInvoiceActionSchema = z.enum([
  'edit', 'delete', 'post', 'reset_to_draft', 'cancel', 'debit_note', 'register_payment', 'pdf', 'zatca_submit', 'zatca_retry',
])
export const FinancePaymentActionSchema = z.enum(['cancel', 'reset_to_draft', 'post', 'edit', 'allocate', 'unallocate'])

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
  ...financeActions(FinanceInvoiceActionSchema),
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
  ...financeActions(FinancePaymentActionSchema),
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
export type FinanceActionBlockReason = z.infer<typeof FinanceActionBlockReasonSchema>
export type FinanceInvoiceAction = z.infer<typeof FinanceInvoiceActionSchema>
export type FinancePaymentAction = z.infer<typeof FinancePaymentActionSchema>
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

// The request bodies of the setup records: accounts, journals, taxes and payment terms.
const currencyCode = z.string().min(1).max(8).nullable()

/** POST /finance/accounts (`finance.accounts.manage`). `currency` is a code; `null` means the company currency. */
export const FinanceAccountCreateSchema = z.object({
  code: text.min(1),
  name: text.min(1),
  account_type: FinanceAccountTypeSchema,
  reconcile: z.boolean().optional(),
  currency: currencyCode.optional(),
}).strict()

/** PATCH /finance/accounts/{id}. An account with journal items keeps its type (422 `account_in_use`). */
export const FinanceAccountPatchSchema = FinanceAccountCreateSchema.partial().strict()
  .refine(requirePatchField, PATCH_MESSAGE)

const JournalTypeSchema = z.enum(['sale', 'purchase', 'cash', 'bank', 'credit', 'general'])

/** POST /finance/journals (`finance.journals.manage`). A bank or cash journal names its default account. */
export const FinanceJournalCreateSchema = z.object({
  name: text.min(1),
  code: text.min(1),
  type: JournalTypeSchema,
  currency: currencyCode.optional(),
  default_account_id: id.optional(),
}).strict().refine(
  body => !['bank', 'cash'].includes(body.type) || body.default_account_id !== undefined,
  'a bank or cash journal needs default_account_id',
)

/** PATCH /finance/journals/{id}: the type is fixed at creation. */
export const FinanceJournalPatchSchema = z.object({
  name: text.min(1).optional(),
  code: text.min(1).optional(),
  currency: currencyCode.optional(),
  default_account_id: id.optional(),
}).strict().refine(requirePatchField, PATCH_MESSAGE)

/** POST /finance/taxes (`finance.taxes.manage`). `tax_account_id` is where the tax amount is booked. */
export const FinanceTaxCreateSchema = z.object({
  name: text.min(1),
  type_tax_use: z.enum(['sale', 'purchase']),
  amount_type: z.enum(['percent', 'fixed']).optional(),
  amount: money.min(0),
  price_include: z.boolean().optional(),
  tax_account_id: id,
}).strict()

/** PATCH /finance/taxes/{id}. A tax used by journal items can only be renamed (422 `tax_in_use`). */
export const FinanceTaxPatchSchema = FinanceTaxCreateSchema.partial().strict()
  .refine(requirePatchField, PATCH_MESSAGE)

/** The lines of a payment term as the request sends them (`delay_type` defaults to days after the invoice date). */
export const FinancePaymentTermLineInputSchema = FinancePaymentTermLineSchema.partial({ delay_type: true, nb_days: true }).strict()

/** POST /finance/payment-terms (`finance.payment_terms.manage`): the percent lines add up to 100. */
export const FinancePaymentTermCreateSchema = z.object({
  name: text.min(1),
  note: text.optional(),
  lines: z.array(FinancePaymentTermLineInputSchema).min(1).max(12),
}).strict().refine(
  body => Math.abs(body.lines.filter(line => line.value === 'percent').reduce((sum, line) => sum + line.value_amount, 0) - 100) < 1e-6,
  'the percent lines must add up to 100',
)

/** PATCH /finance/payment-terms/{id}: a body with `lines` replaces them all. */
export const FinancePaymentTermPatchSchema = z.object({
  name: text.min(1).optional(),
  note: text.optional(),
  lines: FinancePaymentTermCreateSchema.shape.lines.optional(),
}).strict().refine(requirePatchField, PATCH_MESSAGE)

export type FinanceAccountCreate = z.infer<typeof FinanceAccountCreateSchema>
export type FinanceAccountPatch = z.infer<typeof FinanceAccountPatchSchema>
export type FinanceJournalCreate = z.infer<typeof FinanceJournalCreateSchema>
export type FinanceJournalPatch = z.infer<typeof FinanceJournalPatchSchema>
export type FinanceTaxCreate = z.infer<typeof FinanceTaxCreateSchema>
export type FinanceTaxPatch = z.infer<typeof FinanceTaxPatchSchema>
export type FinancePaymentTermCreate = z.infer<typeof FinancePaymentTermCreateSchema>
export type FinancePaymentTermPatch = z.infer<typeof FinancePaymentTermPatchSchema>

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
