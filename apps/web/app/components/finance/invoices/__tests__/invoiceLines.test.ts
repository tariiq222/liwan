import { describe, expect, it } from 'vitest'
import { FinanceInvoiceCreateSchema, FinanceInvoicePatchSchema, type FinanceInvoiceDetail } from '@liwan/contracts'
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
  offersAssetProfile,
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
    lines: [{ id: 1, name: 'Item', account: { id: 40, name: 'Sales' }, quantity: 3, price_unit: 10, discount: 0, taxes: [{ id: 2, name: 'VAT' }], price_subtotal: 30, price_total: 34.5, analytic_distribution: [], asset_profile: null, asset: null }],
  } as unknown as FinanceInvoiceDetail

  it('loads a record with its taxes and account so a patch keeps them', () => {
    const draft = invoiceDraftFromRecord(record)
    expect(draft).toMatchObject({ partnerId: 5, invoiceDate: '2026-04-01', invoiceDateDue: null, ref: 'R1' })
    expect(buildLinePayload(draft.lines[0]!)).toEqual({ name: 'Item', quantity: 3, price_unit: 10, discount: 0, tax_ids: [2], account_id: 40 })
  })

  it('keeps the asset profile of a bill line through the load and save round trip', () => {
    const withProfile = {
      ...record,
      lines: record.lines.map(line => ({ ...line, asset_profile: { id: 9, name: 'Furniture' } })),
    } as unknown as FinanceInvoiceDetail
    const draft = invoiceDraftFromRecord(withProfile)
    expect(draft.lines[0]!.assetProfileId).toBe(9)
    expect(buildInvoicePatch(draft).lines![0]).toMatchObject({ asset_profile_id: 9 })
    expect(buildLinePayload({ ...newLine(), name: 'x', priceUnit: '1' })).not.toHaveProperty('asset_profile_id')
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

describe('payment term in the editor', () => {
  it('does not fail a stale due date while a term is chosen, and still does without one', () => {
    const draft = Object.assign(filled(), { invoiceDate: '2026-04-10', invoiceDateDue: '2026-04-01', paymentTermId: 7 })
    expect(validateInvoiceDraft(draft).dueBeforeDate).toBe(false)
    expect(hasInvoiceErrors(validateInvoiceDraft(draft))).toBe(false)
    expect(validateInvoiceDraft({ ...draft, paymentTermId: null }).dueBeforeDate).toBe(true)
  })

  it('sends the term and leaves the due date to the server', () => {
    const draft = Object.assign(filled(), { invoiceDate: '2026-04-01', invoiceDateDue: '2026-05-01', paymentTermId: 7 })
    const body = buildInvoicePatch(draft)
    expect(body.payment_term_id).toBe(7)
    expect(body).not.toHaveProperty('invoice_date_due')
  })

  it('sends a typed due date and no term otherwise', () => {
    const body = buildInvoicePatch(Object.assign(filled(), { invoiceDateDue: '2026-05-01' }))
    expect(body).toMatchObject({ invoice_date_due: '2026-05-01', payment_term_id: null })
  })
})

describe('the asset profile of a line', () => {
  it('is offered on vendor bills to fixed-asset managers only', () => {
    expect(offersAssetProfile('in_invoice', true)).toBe(true)
    expect(offersAssetProfile('in_invoice', false)).toBe(false)
    for (const moveType of ['out_invoice', 'out_refund', 'in_refund'] as const) expect(offersAssetProfile(moveType, true)).toBe(false)
  })

  it('is sent only when chosen, and a line loaded without one sends none', () => {
    const line = { ...newLine(), name: 'Laptop', priceUnit: '4000' }
    expect(buildLinePayload(line)).not.toHaveProperty('asset_profile_id')
    expect(buildLinePayload({ ...line, assetProfileId: 9 })).toMatchObject({ asset_profile_id: 9 })
  })
})
