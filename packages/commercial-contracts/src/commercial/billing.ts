import { z } from 'zod'
import { moneySchema, revisionIdSchema } from './schemas.js'

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
/**
 * The label of the tax line a policy charges, or null when the policy charges no tax. Liwan is not VAT-registered
 * (owner decision 2026-11-06), so the active policy is `none` and every Liwan invoice carries no label; a registered
 * future policy names its own rate here. The label is never forced onto an invoice.
 */
export const TAX_LABELS = { 'none': null, 'vat_exclusive': 'VAT 15% exclusive' } as const
export type TaxLabel = (typeof TAX_LABELS)[keyof typeof TAX_LABELS]
/** `null` for the policy that charges no tax, otherwise that policy's own label. */
export const taxLabelSchema = z.union([z.null(), z.literal(TAX_LABELS.vat_exclusive)])
export function taxLabelOf(tax: { kind: keyof typeof TAX_LABELS }): TaxLabel {
  return TAX_LABELS[tax.kind] ?? null
}

export const invoiceKindSchema = z.enum(['initial', 'change', 'renewal', 'adjustment'])
export const invoiceStatusSchema = z.enum(['draft', 'issued', 'paid', 'void', 'credit_pending'])
export const invoiceLineSchema = z.strictObject({
  key: z.string(), kind: z.enum(['base', 'bundle', 'branch', 'users', 'storage', 'onboarding', 'discount', 'tax', 'adjustment']),
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
  created_at: z.string(), created_by: z.string().min(1),
  /** Set together, only once the operator recorded the refund made outside the system. */
  refund_reference: z.string().nullable(), refunded_at: z.string().nullable(), refunded_by: z.string().nullable(),
}).refine(a => (a.status === 'refunded') === (a.refund_reference !== null && a.refunded_at !== null && a.refunded_by !== null)
  && (a.status === 'refunded' || (a.refund_reference === null && a.refunded_at === null && a.refunded_by === null)),
{ path: ['status'], message: 'Refund details exactly when refunded' })

/** Vendor-only: record that a pending credit note was refunded outside the system (no automatic refund exists). */
export const refundCreditNoteRequestSchema = z.strictObject({
  external_reference: z.string().trim().min(3).max(200),
  reason: z.string().trim().min(3).max(1000),
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
export type Adjustment = z.infer<typeof adjustmentSchema>
export type RefundCreditNoteRequest = z.infer<typeof refundCreditNoteRequestSchema>
export type PaymentAttempt = z.infer<typeof paymentAttemptSchema>
export type PaymentAttemptStatus = z.infer<typeof paymentAttemptStatusSchema>
export type PaymentEventRecord = z.infer<typeof paymentEventRecordSchema>
