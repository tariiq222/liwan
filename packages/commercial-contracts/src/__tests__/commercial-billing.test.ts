import { describe, expect, it } from 'vitest'
import { invoiceSchema, paymentAttemptSchema, paymentEventRecordSchema, adjustmentSchema, refundCreditNoteRequestSchema, customerInvoiceExtrasSchema, sellerIdentitySchema } from '../commercial/index.js'

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const sar = (minor: number) => ({ currency: 'SAR', exponent: 2, minor })
const line = { key: 'base', kind: 'base', timing: 'now', description: 'x', quantity: 1, unit_amount: sar(10000), amount: sar(10000), period_start: '2026-10-01', period_end: '2026-10-31', source_revision_id: id(1) }
const inv = { id: 'i', number: 'INV-1', customer_id: 'c', subscription_id: 's', order_id: 'o', kind: 'initial', status: 'issued', currency: 'SAR', lines: [line],
  subtotal: sar(10000), tax: sar(1500), total: sar(11500), period_start: '2026-10-01', period_end: '2026-10-31', issued_at: 'x', due_at: null, paid_at: null,
  tax_label: 'VAT 15% exclusive', official_tax_invoice: false }

const note = { id: 'a', invoice_id: 'i', customer_id: 'c', kind: 'credit_note', origin: 'system', reason: 'late activation', amount: sar(500), created_at: 'x', created_by: 'v', refund_reference: null, refunded_at: null, refunded_by: null }

describe('invoice', () => {
  it('parses; never an official tax invoice', () => {
    expect(invoiceSchema.parse(inv).official_tax_invoice).toBe(false)
    expect(invoiceSchema.safeParse({ ...inv, official_tax_invoice: true }).success).toBe(false)
    expect(invoiceSchema.safeParse({ ...inv, tax_label: 'VAT' }).success).toBe(false)
  })
  it('number only when issued', () => {
    expect(invoiceSchema.safeParse({ ...inv, status: 'draft', number: null }).success).toBe(true)
    expect(invoiceSchema.safeParse({ ...inv, status: 'draft', number: 'INV-2' }).success).toBe(false)
    expect(invoiceSchema.safeParse({ ...inv, number: null }).success).toBe(false)
  })
  it('adjustments are separate documents', () => {
    expect(adjustmentSchema.safeParse({ ...note, status: 'pending' }).success).toBe(true)
  })
  it('an adjustment says who raised it: the vendor or the system, nothing else', () => {
    expect(adjustmentSchema.safeParse({ ...note, origin: 'vendor', status: 'pending' }).success).toBe(true)
    expect(adjustmentSchema.safeParse({ ...note, origin: 'customer', status: 'pending' }).success).toBe(false)
    const { origin: _origin, ...withoutOrigin } = note
    expect(adjustmentSchema.safeParse({ ...withoutOrigin, status: 'pending' }).success).toBe(false)
  })
  it('refund details exist exactly when the note is refunded', () => {
    const refund = { refund_reference: 'MOY-REF-1', refunded_at: '2026-10-27T10:00:00.000Z', refunded_by: 'account:7' }
    expect(adjustmentSchema.safeParse({ ...note, status: 'refunded', ...refund }).success).toBe(true)
    expect(adjustmentSchema.safeParse({ ...note, status: 'refunded' }).success).toBe(false)
    expect(adjustmentSchema.safeParse({ ...note, status: 'pending', ...refund }).success).toBe(false)
    expect(adjustmentSchema.safeParse({ ...note, status: 'refunded', ...refund, refunded_by: null }).success).toBe(false)
  })
  it('the refund request needs a reference and a reason, and nothing else', () => {
    const ok = { external_reference: 'MOY-REF-1', reason: 'Refunded in the provider dashboard' }
    expect(refundCreditNoteRequestSchema.parse({ ...ok, external_reference: '  MOY-REF-1  ' }).external_reference).toBe('MOY-REF-1')
    for (const bad of [{ ...ok, external_reference: 'ab' }, { ...ok, reason: 'no' }, { ...ok, external_reference: 'x'.repeat(201) }, { ...ok, reason: 'x'.repeat(1001) }, { ...ok, amount: 1 }, { reason: ok.reason }, { external_reference: ok.external_reference }])
      expect(refundCreditNoteRequestSchema.safeParse(bad).success).toBe(false)
  })
})
describe('payment records', () => {
  const att = { id: 'a', order_id: 'o', invoice_id: 'i', provider: 'moyasar', mode: 'test', kind: 'hosted_invoice', provider_ref: null, amount: sar(11500), status: 'created', redirect_url: null, created_at: 'x', updated_at: 'x' }
  it('attempt parses; unknown provider rejected', () => {
    expect(paymentAttemptSchema.parse(att).status).toBe('created')
    expect(paymentAttemptSchema.safeParse({ ...att, provider: 'stripe' }).success).toBe(false)
    expect(paymentAttemptSchema.safeParse({ ...att, status: 'paid' }).success).toBe(false)
    expect(paymentAttemptSchema.safeParse({ ...att, kind: 'form' }).success).toBe(true)
    expect(paymentAttemptSchema.safeParse({ ...att, kind: 'token' }).success).toBe(false)
    expect(paymentAttemptSchema.safeParse({ ...att, kind: undefined }).success).toBe(false)
  })
  it('rejected events need a reason', () => {
    const ev = { id: 'e', provider: 'moyasar', provider_event_id: 'E', attempt_id: 'a', status: 'succeeded', amount: sar(1), verified: true, confirmed: false, outcome: 'rejected', reason: null, received_at: 'x' }
    expect(paymentEventRecordSchema.safeParse(ev).success).toBe(false)
    expect(paymentEventRecordSchema.safeParse({ ...ev, reason: 'amount_mismatch' }).success).toBe(true)
  })
})

describe('customer invoice extras', () => {
  const seller = { legal_name_ar: 'ليوان', legal_name_en: 'Liwan', commercial_registration: '', address: '', city: 'Riyadh', country: 'SA', email: '', phone: '' }
  const credit = { id: 'a', amount: sar(500), cause: 'vendor_refund', status: 'refunded', created_at: 'x', refunded_at: 'y', refund_reference: 'R-1' }
  it('carries the seller, the buyer name and the credit notes a customer may see', () => {
    expect(customerInvoiceExtrasSchema.parse({ customer_name: 'شركة', seller, credit_notes: [credit] }).credit_notes).toHaveLength(1)
    expect(customerInvoiceExtrasSchema.safeParse({ customer_name: 'شركة', seller: null, credit_notes: [] }).success).toBe(true)
  })
  it('never carries operator names, the free-text reason or a tax number', () => {
    expect(customerInvoiceExtrasSchema.safeParse({ customer_name: 'x', seller: null, credit_notes: [{ ...credit, created_by: 'op' }] }).success).toBe(false)
    expect(customerInvoiceExtrasSchema.safeParse({ customer_name: 'x', seller: null, credit_notes: [{ ...credit, reason: 'internal' }] }).success).toBe(false)
    expect(sellerIdentitySchema.safeParse({ ...seller, vat_number: '300' }).success).toBe(false)
  })
})

import { formPaymentSessionSchema, paymentAttemptRequestSchema } from '../commercial/billing.js'

describe('payment attempt request', () => {
  it('defaults to the hosted invoice and keeps no card', () => {
    expect(paymentAttemptRequestSchema.parse({})).toEqual({ method: 'hosted_invoice', save_card: false })
    expect(paymentAttemptRequestSchema.parse({ method: 'form' })).toEqual({ method: 'form', save_card: false })
  })
  it('saving the card needs the form and the consent text version', () => {
    expect(paymentAttemptRequestSchema.parse({ method: 'form', save_card: true, consent_text_version: 'v1' })).toMatchObject({ save_card: true, consent_text_version: 'v1' })
    expect(paymentAttemptRequestSchema.safeParse({ method: 'form', save_card: true }).success).toBe(false)
    expect(paymentAttemptRequestSchema.safeParse({ method: 'form', save_card: true, consent_text_version: '' }).success).toBe(false)
    expect(paymentAttemptRequestSchema.safeParse({ method: 'hosted_invoice', save_card: true, consent_text_version: 'v1' }).success).toBe(false)
    expect(paymentAttemptRequestSchema.safeParse({ method: 'form', consent_text_version: 'v1' }).success).toBe(false)
  })
  it('refuses a consent time from the caller, an unknown method and an idempotency key (the live attempt makes a repeat safe)', () => {
    expect(paymentAttemptRequestSchema.safeParse({ method: 'form', consent_at: '2026-01-01T00:00:00Z' }).success).toBe(false)
    expect(paymentAttemptRequestSchema.safeParse({ method: 'saved_card' }).success).toBe(false)
    expect(paymentAttemptRequestSchema.safeParse({ idempotency_key: id(1) }).success).toBe(false)
  })
})

describe('form payment session', () => {
  const session = { attempt_id: id(1), intent: { id: 'intent_1', client_secret: 'secret_1' }, publishable_key: 'pk_test_x', amount: sar(11500), expires_at: '2026-11-13T20:00:00.000Z' }
  it('carries the intent, the publishable key and the amount, and nothing more', () => {
    expect(formPaymentSessionSchema.parse(session)).toEqual(session)
    expect(formPaymentSessionSchema.safeParse({ ...session, secret_key: 'sk_test_x' }).success).toBe(false)
    expect(formPaymentSessionSchema.safeParse({ ...session, intent: { id: 'i' } }).success).toBe(false)
  })
})
