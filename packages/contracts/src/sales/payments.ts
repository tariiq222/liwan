import { z } from 'zod'
import { PaymentRefundCreateSchema } from '../payments'

// The `liwan_sales_payments` bridge: a quotation that asks to be paid, and is confirmed by the payment. Every field here
// is optional in the Sales shapes that carry it, because the bridge adds it only while online payments are installed
// and included in the tenant's plan (R8, R10). A page that finds the field absent or null shows no payment at all.
// Received money is what authorized and done payments brought, less done refunds; only done money can be refunded.

/** How a quotation asks to be paid: not at all, all of it, or a percentage of it. */
export const SalesPaymentToConfirmSchema = z.enum(['off', 'full', 'percent'])

export const SALES_PREPAYMENT_PERCENT = { min: 1, max: 100 } as const

export const SalesPrepaymentPercentSchema = z.number().int().min(SALES_PREPAYMENT_PERCENT.min).max(SALES_PREPAYMENT_PERCENT.max)

/** The tenant's default for a new quotation and the share of the total a percentage payment asks for. Read and written with the Sales settings. */
export const SalesPaymentSettingsShape = {
  payment_to_confirm: SalesPaymentToConfirmSchema,
  prepayment_percent: SalesPrepaymentPercentSchema,
} as const

/** The choice of one quotation, in the body of a create and of an edit of a draft. `prepayment_percent` goes with `percent` only. */
export const SalesPaymentChoiceShape = {
  payment_to_confirm: SalesPaymentToConfirmSchema.optional(),
  prepayment_percent: SalesPrepaymentPercentSchema.optional(),
} as const

/** The payer's status of the online order behind a quotation, or `none` while the quotation asks for nothing. */
export const SalesOrderPaymentStatusSchema = z.enum(['none', 'payable', 'processing', 'paid', 'not_payable', 'cancelled'])
/**
 * What the customer can do about the payment now: pay (`ready`), sign first, nothing (`none`: nothing asked, paid, being
 * paid or confirmed), `no_gateway` (payable but no live gateway: switch one to live) or `unavailable` (expired, not sent).
 */
export const SalesOrderPaymentLinkSchema = z.enum(['none', 'ready', 'awaiting_signature', 'no_gateway', 'unavailable'])
/** Why a person must look at the money of an order: received but not recorded for an hour, or confirmed and then a payment it counted was voided. */
export const SalesOrderPaymentAttentionSchema = z.enum(['payment_not_recorded', 'payment_reversed'])
/** Why money on a quotation does not confirm it: `expired`, `reopened`, `cancelled` (any amount, due back) or `awaiting_signature` (what it asks arrived, the customer signs first). */
export const SalesOrderPaymentHeldSchema = z.enum(['expired', 'reopened', 'cancelled', 'awaiting_signature'])

/**
 * The payment of a staff quotation on its record page. `amount_required` is what must be received before the order is
 * confirmed, `amount_received` what it received less refunds, `amount_due` what the customer still pays, `amount_to_refund`
 * what the seller must give back (money held on an expired, reopened or cancelled quotation, or beyond the total of a
 * confirmed order), `amount_refundable` the most one refund may record now, and `can_refund` whether the reader may record
 * one (`POST /api/v1/sales/orders/{id}/refunds`). `needs_attention` is true exactly when `attention` names a reason. A required amount of zero asks for nothing: `status` and `link` read `none`.
 */
export const SalesOrderPaymentSchema = z.object({
  mode: SalesPaymentToConfirmSchema,
  percent: SalesPrepaymentPercentSchema,
  currency: z.string().length(3),
  amount_required: z.number().nonnegative(),
  amount_received: z.number(),
  amount_due: z.number().nonnegative(),
  amount_to_refund: z.number().nonnegative(),
  amount_refundable: z.number().nonnegative(),
  can_refund: z.boolean(),
  status: SalesOrderPaymentStatusSchema,
  link: SalesOrderPaymentLinkSchema,
  held: SalesOrderPaymentHeldSchema.nullable(),
  needs_attention: z.boolean(),
  attention: SalesOrderPaymentAttentionSchema.nullable(),
}).strict()

/**
 * `awaiting_signature`: the customer signs the quotation first; `paid`: the order is confirmed with what it asked;
 * `received`: what it asks arrived and the seller has not confirmed the order yet; `unavailable`: expired, cancelled
 * unpaid, or no live gateway.
 */
export const SalesPublicPaymentStateSchema = z.enum(['payable', 'awaiting_signature', 'processing', 'paid', 'received', 'unavailable'])

/** What the holder of a quotation link sees of its payment: the amount due now and the pay page's path (null unless `payable`). */
export const SalesPublicPaymentSchema = z.object({
  percent: SalesPrepaymentPercentSchema,
  amount: z.number().nonnegative(),
  currency: z.string().length(3),
  pay_url: z.string().regex(/^\/pay\/order\/\d+\?access_token=[\w-]{1,128}$/).nullable(),
  state: SalesPublicPaymentStateSchema,
}).strict()

/**
 * The body of `POST /api/v1/sales/orders/{id}/refunds`: the payments refund body (what was refunded at the gateway and its
 * refund reference), at most `amount_refundable`. The answer is the order (`SalesOrderSchema`).
 */
export const SalesOrderRefundBodySchema = PaymentRefundCreateSchema

export type SalesPaymentToConfirm = z.infer<typeof SalesPaymentToConfirmSchema>
export type SalesOrderPayment = z.infer<typeof SalesOrderPaymentSchema>
export type SalesPublicPayment = z.infer<typeof SalesPublicPaymentSchema>
export type SalesOrderRefundBody = z.infer<typeof SalesOrderRefundBodySchema>
