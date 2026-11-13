import { z } from 'zod'
import { moneySchema, revisionIdSchema } from './schemas.js'

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
/**
 * The label of the tax line a policy charges, or null when the policy charges no tax. Liwan is not VAT-registered
 * (owner decision 2026-11-06), so the active policy is `none` and every Liwan invoice carries no label; a registered
 * future policy names its own rate here. The label is never forced onto an invoice.
 */
// Only the label an invoice can actually carry: an untaxed invoice has no label at all (the field is null),
// so a `none` entry here would be a second way to spell the same thing.
export const TAX_LABELS = { 'vat_exclusive': 'VAT 15% exclusive' } as const
export type TaxLabel = (typeof TAX_LABELS)[keyof typeof TAX_LABELS]
/** `null` for the policy that charges no tax, otherwise that policy's own label. */
export const taxLabelSchema = z.union([z.null(), z.literal(TAX_LABELS.vat_exclusive)])


export const invoiceKindSchema = z.enum(['initial', 'change', 'renewal', 'adjustment'])
export const invoiceStatusSchema = z.enum(['draft', 'issued', 'paid', 'void', 'credit_pending'])
export const invoiceLineSchema = z.strictObject({
  key: z.string(), kind: z.enum(['base', 'bundle', 'branch', 'users', 'storage', 'onboarding', 'ai_topup', 'discount', 'tax', 'adjustment']),
  timing: z.enum(['now', 'renewal']), description: z.string(), quantity: z.number().int().min(0),
  unit_amount: moneySchema, amount: moneySchema, period_start: isoDate, period_end: isoDate,
  source_revision_id: revisionIdSchema, free_quantity: z.number().int().min(0).optional(),
})
/**
 * Commercial invoice for the customer: Liwan's own billing document, never a tax document of the customer's business.
 * `tax_label` is null unless the invoice's pricing policy charges tax, and `official_tax_invoice` is always false:
 * no Liwan invoice is an official tax document (owner decision 2026-11-06). Issued invoices are immutable;
 * corrections use adjustments/credit notes.
 */
export const invoiceSchema = z.strictObject({
  id: z.string().min(1), number: z.string().nullable(), customer_id: z.string().min(1),
  subscription_id: z.string().min(1), order_id: z.string().nullable(),
  kind: invoiceKindSchema, status: invoiceStatusSchema, currency: z.string().regex(/^[A-Z]{3}$/),
  lines: z.array(invoiceLineSchema), subtotal: moneySchema, tax: moneySchema, total: moneySchema,
  period_start: isoDate, period_end: isoDate,
  issued_at: z.string().nullable(), due_at: z.string().nullable(), paid_at: z.string().nullable(),
  tax_label: taxLabelSchema, official_tax_invoice: z.literal(false),
}).refine(i => (i.status === 'draft') === (i.number === null) || i.status === 'void', { path: ['number'], message: 'Number only once issued' })
  // No label without a tax amount, and no tax amount without the label of the policy that charged it.
  .refine(i => (i.tax_label === null) === (i.tax.minor === 0), { path: ['tax_label'], message: 'A tax label exists exactly when the invoice taxes' })

/** Separate immutable correction document (issued invoices are never edited). */
export const adjustmentSchema = z.strictObject({
  id: z.string().min(1), invoice_id: z.string().min(1), customer_id: z.string().min(1),
  kind: z.enum(['credit_note', 'debit_note']), reason: z.string().min(3).max(1000),
  amount: moneySchema, status: z.enum(['pending', 'applied', 'refunded', 'void']),
  /** Who raised it: a vendor-requested full refund of a first payment, or the system (duplicate charge, late payment, failed fulfilment). */
  origin: z.enum(['vendor', 'system']),
  created_at: z.string(), created_by: z.string().min(1),
  /** Set together, only once the operator recorded the refund made outside the system. */
  refund_reference: z.string().nullable(), refunded_at: z.string().nullable(), refunded_by: z.string().nullable(),
}).refine(a => (a.status === 'refunded') === (a.refund_reference !== null && a.refunded_at !== null && a.refunded_by !== null)
  && (a.status === 'refunded' || (a.refund_reference === null && a.refunded_at === null && a.refunded_by === null)),
{ path: ['status'], message: 'Refund details exactly when refunded' })

/**
 * Who sells: the vendor's legal identity as the billing settings held it when the invoice was issued. Every field but a
 * legal name is optional (an empty string is "not set"). There is no tax field: the vendor is not VAT-registered.
 */
export const sellerIdentitySchema = z.strictObject({
  legal_name_ar: z.string(), legal_name_en: z.string(), commercial_registration: z.string(),
  address: z.string(), city: z.string(), country: z.string(), email: z.string(), phone: z.string(),
})

/** Why a credit note exists, as a customer may be told: the typed cause, never the operator's free-text reason. */
export const creditNoteCauseSchema = z.enum(['vendor_refund', 'duplicate_payment', 'provider_refund', 'payment_after_cancellation', 'automatic_refund', 'fulfillment_failure'])
/** A credit note on a customer's own invoice: no operator names, no free text, only a reference the customer can quote. */
export const customerCreditNoteSchema = z.strictObject({
  id: z.string().min(1), amount: moneySchema, cause: creditNoteCauseSchema,
  status: z.enum(['pending', 'applied', 'refunded']),
  created_at: z.string(), refunded_at: z.string().nullable(), refund_reference: z.string().nullable(),
})
/** What the customer's invoice page and printable document add to the invoice itself. */
export const customerInvoiceExtrasSchema = z.strictObject({
  /** The customer's legal name as the control plane holds it. */
  customer_name: z.string().min(1),
  seller: sellerIdentitySchema.nullable(),
  credit_notes: z.array(customerCreditNoteSchema),
})

/** Vendor-only: record that a pending credit note was refunded outside the system (no automatic refund exists). */
export const refundCreditNoteRequestSchema = z.strictObject({
  external_reference: z.string().trim().min(3).max(200),
  reason: z.string().trim().min(3).max(1000),
})

/** A customer's "I made the transfer" for one issued invoice: the day it says it paid, an optional sender name or bank reference, and when it was first said. */
export const bankTransferClaimSchema = z.strictObject({
  value_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  sender_reference: z.string().nullable(),
  claimed_at: z.iso.datetime(),
})
export const bankTransferClaimRequestSchema = z.strictObject({
  value_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  sender_reference: z.string().trim().max(200).optional(),
})

export const paymentProviderSchema = z.enum(['moyasar', 'simulator'])
export const paymentModeSchema = z.enum(['test', 'live', 'simulator'])
export const paymentAttemptStatusSchema = z.enum(['created', 'redirected', 'pending', 'succeeded', 'failed', 'canceled', 'unknown'])
export const paymentAttemptSchema = z.strictObject({
  id: z.string().min(1), order_id: z.string().min(1), invoice_id: z.string().min(1),
  provider: paymentProviderSchema, mode: paymentModeSchema, provider_ref: z.string().nullable(),
  amount: moneySchema, status: paymentAttemptStatusSchema, redirect_url: z.string().nullable(),
  created_at: z.string(), updated_at: z.string(),
})
/** Provider event ledger: (provider, provider_event_id) is unique; a verified signature alone never confirms payment. */
export const paymentEventRecordSchema = z.strictObject({
  id: z.string().min(1), provider: paymentProviderSchema, provider_event_id: z.string().min(1),
  attempt_id: z.string().nullable(), status: z.enum(['pending', 'succeeded', 'failed', 'refunded', 'canceled']),
  amount: moneySchema, verified: z.boolean(), confirmed: z.boolean(),
  outcome: z.enum(['accepted', 'rejected']), reason: z.string().nullable(), received_at: z.string(),
}).refine(e => e.outcome === 'accepted' ? e.reason === null || e.reason.length > 0 : Boolean(e.reason), { path: ['reason'], message: 'Rejected events need a reason' })

export type InvoiceKind = z.infer<typeof invoiceKindSchema>
export type InvoiceStatus = z.infer<typeof invoiceStatusSchema>
export type InvoiceLine = z.infer<typeof invoiceLineSchema>
export type Invoice = z.infer<typeof invoiceSchema>
export type BankTransferClaim = z.infer<typeof bankTransferClaimSchema>
export type BankTransferClaimRequest = z.infer<typeof bankTransferClaimRequestSchema>
export type SellerIdentity = z.infer<typeof sellerIdentitySchema>
export type CreditNoteCause = z.infer<typeof creditNoteCauseSchema>
export type CustomerCreditNote = z.infer<typeof customerCreditNoteSchema>
/** One invoice as its own customer reads it. */
export type CustomerInvoice = Invoice & z.infer<typeof customerInvoiceExtrasSchema>
export type Adjustment = z.infer<typeof adjustmentSchema>
export type RefundCreditNoteRequest = z.infer<typeof refundCreditNoteRequestSchema>
export type PaymentAttempt = z.infer<typeof paymentAttemptSchema>
export type PaymentAttemptStatus = z.infer<typeof paymentAttemptStatusSchema>
export type PaymentEventRecord = z.infer<typeof paymentEventRecordSchema>
