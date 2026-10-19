import { describe, expect, it } from 'vitest'
import { FinanceInvoiceCreateSchema, FinanceInvoicePatchSchema, type FinanceInvoiceDetail } from '@webvue/contracts'
import {
  buildInvoiceCreate,
  buildInvoicePatch,
  buildLinePayload,
  emptyInvoiceDraft,
  hasInvoiceErrors,
  invoiceDraftDirty,
  invoiceDraftFromRecord,
  lineSubtotal,
  newLine,
  validateInvoiceDraft,
} from '../invoiceLines'

function filled() {
  const draft = emptyInvoiceDraft()
  draft.partnerId = 5
  Object.assign(draft.lines[0]!, { name: '  Consulting ', quantity: '2', priceUnit: '150.5', discount: '10' })
  return draft
}

describe('line payload', () => {
  it('trims the description and sends numbers, leaving taxes to the account default', () => {
    const payload = buildLinePayload(filled().lines[0]!)
    expect(payload).toEqual({ name: 'Consulting', quantity: 2, price_unit: 150.5, discount: 10 })
    expect(payload).not.toHaveProperty('tax_ids')
  })

  it('"no tax" sends an explicit empty tax list', () => {
    expect(buildLinePayload({ ...filled().lines[0]!, noTax: true }).tax_ids).toEqual([])
  })

  it('keeps the taxes and account a loaded line already had', () => {
    const line = { ...newLine(), name: 'x', priceUnit: '1', taxIds: [3, 4], accountId: 12 }
    expect(buildLinePayload(line)).toMatchObject({ tax_ids: [3, 4], account_id: 12 })
  })

  it('the create and patch bodies satisfy the contract', () => {
    const draft = Object.assign(filled(), { invoiceDate: '2026-04-01', invoiceDateDue: '2026-05-01', ref: ' PO-1 ' })
    expect(FinanceInvoiceCreateSchema.parse(buildInvoiceCreate('in_invoice', draft))).toMatchObject({ move_type: 'in_invoice', partner_id: 5, ref: 'PO-1' })
    expect(FinanceInvoicePatchSchema.parse(buildInvoicePatch(draft)).lines).toHaveLength(1)
  })
})

describe('draft validation', () => {
  it('flags the missing partner and every bad line field', () => {
    const draft = emptyInvoiceDraft()
    Object.assign(draft.lines[0]!, { quantity: '-1', discount: '120' })
    const errors = validateInvoiceDraft(draft)
    expect(errors.partner).toBe(true)
    expect(errors.lines[0]).toEqual({ name: true, quantity: true, priceUnit: true, discount: true })
    expect(hasInvoiceErrors(errors)).toBe(true)
  })

  it('accepts a complete draft and a negative unit price', () => {
    const draft = filled()
    draft.lines[0]!.priceUnit = '-20'
    expect(hasInvoiceErrors(validateInvoiceDraft(draft))).toBe(false)
  })

  it('refuses a due date before the date', () => {
    const draft = Object.assign(filled(), { invoiceDate: '2026-04-10', invoiceDateDue: '2026-04-01' })
    expect(validateInvoiceDraft(draft).dueBeforeDate).toBe(true)
  })
})

describe('editor state', () => {
  const record = {
    partner: { id: 5, name: 'Acme' }, invoice_date: '2026-04-01', invoice_date_due: null, ref: 'R1',
    lines: [{ id: 1, name: 'Item', account: { id: 40, name: 'Sales' }, quantity: 3, price_unit: 10, discount: 0, taxes: [{ id: 2, name: 'VAT' }], price_subtotal: 30, price_total: 34.5, analytic_distribution: [] }],
  } as unknown as FinanceInvoiceDetail

  it('loads a record with its taxes and account so a patch keeps them', () => {
    const draft = invoiceDraftFromRecord(record)
    expect(draft).toMatchObject({ partnerId: 5, invoiceDate: '2026-04-01', invoiceDateDue: null, ref: 'R1' })
    expect(buildLinePayload(draft.lines[0]!)).toEqual({ name: 'Item', quantity: 3, price_unit: 10, discount: 0, tax_ids: [2], account_id: 40 })
  })

  it('knows when nothing changed, ignoring line keys', () => {
    const initial = invoiceDraftFromRecord(record)
    const copy = invoiceDraftFromRecord(record)
    expect(invoiceDraftDirty(copy, initial)).toBe(false)
    copy.lines[0]!.quantity = '4'
    expect(invoiceDraftDirty(copy, initial)).toBe(true)
  })

  it('shows the amount before tax while typing', () => {
    expect(lineSubtotal({ quantity: '2', priceUnit: '150', discount: '10' })).toBeCloseTo(270)
    expect(lineSubtotal({ quantity: '', priceUnit: '150', discount: '0' })).toBe(0)
  })
})
