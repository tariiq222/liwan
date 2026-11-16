import { describe, expect, it } from 'vitest'
import { SalesInvoiceKindSchema, SalesInvoicingStatusSchema } from '@liwan/contracts'
import { INVOICE_STATE_TONE, INVOICING_STATUS_TONE, createInvoiceAttempts, salesInvoicePath } from '../salesInvoicing'

describe('the invoice links of an order', () => {
  it('opens an invoice or a down payment under finance invoices and a credit note under credit notes', () => {
    expect(salesInvoicePath('invoice', 9)).toBe('/finance/sales/invoices/9')
    expect(salesInvoicePath('down_payment', 9)).toBe('/finance/sales/invoices/9')
    expect(salesInvoicePath('credit_note', 9)).toBe('/finance/sales/credit-notes/9')
    expect(SalesInvoiceKindSchema.options).toHaveLength(3)
  })

  it('gives every status and state of the contract a tone', () => {
    expect(Object.keys(INVOICING_STATUS_TONE).sort()).toEqual([...SalesInvoicingStatusSchema.options].sort())
    expect(Object.keys(INVOICE_STATE_TONE).sort()).toEqual(['cancel', 'draft', 'posted'])
  })
})

describe('the idempotency key of an invoice form', () => {
  const counter = () => { let next = 0; return () => `key-${++next}` }

  it('stays the same while the same body is sent again for the same order', () => {
    const attempts = createInvoiceAttempts(counter())
    const first = attempts.keyFor(2, { method: 'percent', percent: 25 })
    expect(attempts.keyFor(2, { method: 'percent', percent: 25 })).toBe(first)
  })

  it('is renewed when the body or the order changes, and after a success', () => {
    const attempts = createInvoiceAttempts(counter())
    const first = attempts.keyFor(2, { method: 'percent', percent: 25 })
    const another = attempts.keyFor(2, { method: 'percent', percent: 30 })
    expect(another).not.toBe(first)
    const elsewhere = attempts.keyFor(3, { method: 'percent', percent: 30 })
    expect(elsewhere).not.toBe(another)
    attempts.settle()
    expect(attempts.keyFor(3, { method: 'percent', percent: 30 })).not.toBe(elsewhere)
  })

  it('makes a key the server accepts', () => {
    expect(createInvoiceAttempts().keyFor(2, { method: 'order' })).toMatch(/^[A-Za-z0-9_.:-]{8,128}$/)
  })
})
