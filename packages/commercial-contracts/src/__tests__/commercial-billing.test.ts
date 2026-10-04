import { describe, expect, it } from 'vitest'
import { invoiceSchema, paymentAttemptSchema, paymentEventRecordSchema, adjustmentSchema } from '../commercial/index.js'

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const sar = (minor: number) => ({ currency: 'SAR', exponent: 2, minor })
const line = { key: 'base', kind: 'base', timing: 'now', description: 'x', quantity: 1, unit_amount: sar(10000), amount: sar(10000), period_start: '2026-10-01', period_end: '2026-10-31', source_revision_id: id(1) }
const inv = { id: 'i', number: 'INV-1', customer_id: 'c', subscription_id: 's', order_id: 'o', kind: 'initial', status: 'issued', currency: 'SAR', lines: [line],
  subtotal: sar(10000), tax: sar(1500), total: sar(11500), period_start: '2026-10-01', period_end: '2026-10-31', issued_at: 'x', due_at: null, paid_at: null,
  tax_label: 'VAT 15% exclusive', official_tax_invoice: false }

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
    expect(adjustmentSchema.safeParse({ id: 'a', invoice_id: 'i', customer_id: 'c', kind: 'credit_note', reason: 'late activation', amount: sar(500), status: 'pending', created_at: 'x', created_by: 'v' }).success).toBe(true)
  })
})
describe('payment records', () => {
  const att = { id: 'a', order_id: 'o', invoice_id: 'i', provider: 'moyasar', mode: 'test', provider_ref: null, amount: sar(11500), status: 'created', redirect_url: null, created_at: 'x', updated_at: 'x' }
  it('attempt parses; unknown provider rejected', () => {
    expect(paymentAttemptSchema.parse(att).status).toBe('created')
    expect(paymentAttemptSchema.safeParse({ ...att, provider: 'stripe' }).success).toBe(false)
    expect(paymentAttemptSchema.safeParse({ ...att, status: 'paid' }).success).toBe(false)
  })
  it('rejected events need a reason', () => {
    const ev = { id: 'e', provider: 'moyasar', provider_event_id: 'E', attempt_id: 'a', status: 'succeeded', amount: sar(1), verified: true, confirmed: false, outcome: 'rejected', reason: null, received_at: 'x' }
    expect(paymentEventRecordSchema.safeParse(ev).success).toBe(false)
    expect(paymentEventRecordSchema.safeParse({ ...ev, reason: 'amount_mismatch' }).success).toBe(true)
  })
})
