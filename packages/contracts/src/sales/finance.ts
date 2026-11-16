import { z } from 'zod'

// The `liwan_sales_finance` bridge: the invoices of a confirmed order and the down payment setting. Every field here is
// optional in the Sales shapes that carry it, because the bridge adds it only while Finance is installed and included in
// the tenant's plan (R8, R10); `invoicing` is null for a caller who cannot read finance invoices, so no number or amount
// reaches them. The invoice itself is finance's: it is made as a draft and posted in finance.

/** Whether a confirmed order may be invoiced in advance (a down payment), or only as a whole. */
export const SalesInvoiceDownPaymentSchema = z.enum(['allow', 'refuse'])

/**
 * Who may invoice an order: `owner` (its salesperson or a holder of `sales.documents.assign`, the actor rule Sales uses for
 * confirm and cancel) or `any_biller` (any caller who reads the order and holds both capabilities).
 */
export const SalesInvoiceActorSchema = z.enum(['owner', 'any_biller'])

/** The settings of the bridge, read and written with the Sales settings; absent while the tenant has no Finance. */
export const SalesFinanceSettingsShape = {
  invoice_down_payment: SalesInvoiceDownPaymentSchema,
  invoice_actor: SalesInvoiceActorSchema,
} as const

/**
 * Where the order stands with its invoices: `none` (not confirmed, or nothing to bill), `to_invoice` (no live invoice yet),
 * `partial` (some invoiced or drafted, some still to invoice) or `invoiced` (nothing left to invoice).
 */
export const SalesInvoicingStatusSchema = z.enum(['none', 'to_invoice', 'partial', 'invoiced'])
/** A final invoice, a down payment (every product line is one) or a credit note that reverses an invoice. */
export const SalesInvoiceKindSchema = z.enum(['invoice', 'down_payment', 'credit_note'])
export const SalesInvoiceStateSchema = z.enum(['draft', 'posted', 'cancel'])
export const SalesInvoicePaymentStateSchema = z.enum(['not_paid', 'in_payment', 'paid', 'partial', 'reversed', 'blocked', 'invoicing_legacy'])

const Id = z.number().int().positive()
const Day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)

/** One invoice or credit note of the order; `number` is null until finance posts it. */
export const SalesOrderInvoiceSchema = z.object({
  id: Id,
  number: z.string().min(1).nullable(),
  state: SalesInvoiceStateSchema,
  kind: SalesInvoiceKindSchema,
  payment_state: SalesInvoicePaymentStateSchema,
  invoice_date: Day.nullable(),
  invoice_date_due: Day.nullable(),
  amount_total: z.number(),
  amount_residual: z.number(),
  currency: z.string().min(1),
}).strict()

/**
 * The invoicing of a staff order, in the currency of the order. `amount_invoiced` and `amount_credited` count posted
 * invoices and posted credit notes, `amount_drafted` the draft invoices (they claim an amount until posted or cancelled),
 * `amount_to_invoice` what no live invoice covers yet (a credit note does not open it again) and `amount_paid` what
 * payments settled on the posted invoices less what credit notes gave back. `invoices` is newest first.
 * `can_invoice` and `can_down_payment` say what the caller may start now.
 */
export const SalesOrderInvoicingSchema = z.object({
  status: SalesInvoicingStatusSchema,
  amount_invoiced: z.number(),
  amount_credited: z.number(),
  amount_drafted: z.number(),
  amount_to_invoice: z.number(),
  amount_paid: z.number(),
  invoices: z.array(SalesOrderInvoiceSchema),
  can_invoice: z.boolean(),
  can_down_payment: z.boolean(),
}).strict()

export const SALES_INVOICE_PERCENT = { min: 1, max: 100 } as const
const MAX_AMOUNT = 1_000_000_000_000

/**
 * The body of `POST /sales/orders/<id>/invoices`: the whole order (what is invoiceable, less the down payments already
 * invoiced), or a down payment by percent (1 to 100 of the order total) or by amount (a total, taxes included, above zero).
 */
export const SalesOrderInvoiceBodySchema = z.discriminatedUnion('method', [
  z.object({ method: z.literal('order') }).strict(),
  z.object({ method: z.literal('percent'), percent: z.number().min(SALES_INVOICE_PERCENT.min).max(SALES_INVOICE_PERCENT.max) }).strict(),
  z.object({ method: z.literal('amount'), amount: z.number().positive().max(MAX_AMOUNT) }).strict(),
])

export type SalesInvoiceDownPayment = z.infer<typeof SalesInvoiceDownPaymentSchema>
export type SalesInvoiceActor = z.infer<typeof SalesInvoiceActorSchema>
export type SalesInvoicingStatus = z.infer<typeof SalesInvoicingStatusSchema>
export type SalesInvoiceKind = z.infer<typeof SalesInvoiceKindSchema>
export type SalesOrderInvoice = z.infer<typeof SalesOrderInvoiceSchema>
export type SalesOrderInvoicing = z.infer<typeof SalesOrderInvoicingSchema>
export type SalesOrderInvoiceBody = z.infer<typeof SalesOrderInvoiceBodySchema>
