import { describe, expect, it } from 'vitest'
import type { ProductPick, SalesOrder } from '@liwan/contracts'
import {
  emptySalesDraft, hasSalesDraftErrors, moveSalesLine, newSalesLine, salesCreateBody, salesDraftFromOrder, salesDraftSnapshot,
  salesLineAmount, salesPatchBody, salesPaymentWithDefaultPercent, validateSalesDraft, withPickedProduct,
} from '../salesOrderDraft'

const currency = { id: 2, name: 'SAR', symbol: 'ر.س' }
const ORDER: SalesOrder = {
  id: 7, number: 'S00007', state: 'draft', locked: false, expired: false, source: 'staff', customer_answer: null, customer: { id: 5, name: 'Acme' },
  salesperson: { id: 2, name: 'Maha', user_id: 2 }, validity_date: '2026-12-14', date: '2026-11-14T08:00:00Z', terms: 'Net 30', currency,
  amount_untaxed: 180, amount_tax: 27, amount_total: 207,
  lines: [
    { id: 3, kind: 'section', product: null, name: 'Services', quantity: 0, unit: null, unit_price: 0, discount_percent: 0, amount_untaxed: 0, amount_tax: 0, amount_total: 0 },
    { id: 4, kind: 'product', product: { id: 9, name: 'Haircut' }, name: 'Haircut', quantity: 2, unit: 'Units', unit_price: 100, discount_percent: 10, amount_untaxed: 180, amount_tax: 27, amount_total: 207 },
  ],
  actions: { edit: true, confirm: true, cancel: true, reopen: false, lock: false, unlock: false, duplicate: true, assign: false, send: true },
  resend_refused: false,
}
const PICK: ProductPick = { id: 11, name: 'Oil', type: 'goods', unit_price: 50, amount_untaxed: 50, amount_tax: 7.5, amount_total: 57.5, currency }

describe('sales order draft', () => {
  it('loads a saved order and sends it back with the same lines, ids and no price', () => {
    const draft = salesDraftFromOrder(ORDER)
    expect(draft.lines.map(line => [line.id, line.kind, line.productId, line.unitPrice])).toEqual([[3, 'section', null, null], [4, 'product', 9, 100]])
    expect(salesPatchBody(ORDER, draft, false)).toEqual({
      customer_id: 5, validity_date: '2026-12-14', terms: 'Net 30',
      lines: [{ id: 3, kind: 'section', name: 'Services' }, { id: 4, kind: 'product', product_id: 9, quantity: 2, discount_percent: 10 }],
    })
  })

  it('sends a salesperson only for the assign right and only when it changed', () => {
    const draft = { ...salesDraftFromOrder(ORDER), salespersonId: 8 }
    expect(salesPatchBody(ORDER, draft, false).salesperson_id).toBeUndefined()
    expect(salesPatchBody(ORDER, draft, true).salesperson_id).toBe(8)
    expect(salesPatchBody(ORDER, salesDraftFromOrder(ORDER), true).salesperson_id).toBeUndefined()
  })

  it('leaves out an empty validity date and empty terms on create, so the tenant defaults apply', () => {
    const draft = { ...emptySalesDraft(), customerId: 5, lines: [withPickedProduct(newSalesLine(), PICK)] }
    expect(salesCreateBody(draft, false)).toEqual({ customer_id: 5, lines: [{ kind: 'product', product_id: 11, quantity: 1, discount_percent: 0 }] })
    expect(salesCreateBody({ ...draft, validityDate: '2027-01-01', terms: ' x ', salespersonId: 8 }, true)).toMatchObject({ validity_date: '2027-01-01', terms: 'x', salesperson_id: 8 })
  })

  it('validates the customer, each product line and each text line', () => {
    const errors = validateSalesDraft({ ...emptySalesDraft(), lines: [newSalesLine(), { ...newSalesLine('note'), name: ' ' }, { ...withPickedProduct(newSalesLine(), PICK), quantity: '0', discount: '120' }] })
    expect(errors).toEqual({ customer: true, noLines: false, payment: false, lines: [{ product: true }, { name: true }, { quantity: true, discount: true }] })
    expect(validateSalesDraft({ ...emptySalesDraft(), lines: [{ ...withPickedProduct(newSalesLine(), PICK), quantity: '1000001' }] }).lines).toEqual([{ quantity: true }])
    expect(validateSalesDraft({ ...emptySalesDraft(), lines: [{ ...withPickedProduct(newSalesLine(), PICK), quantity: '1000000', name: '' }] }).lines).toEqual([{}])
    expect(hasSalesDraftErrors(errors)).toBe(true)
    expect(validateSalesDraft({ ...emptySalesDraft(), customerId: 1, lines: [] }).noLines).toBe(true)
    expect(hasSalesDraftErrors(validateSalesDraft({ ...emptySalesDraft(), customerId: 1, lines: [withPickedProduct(newSalesLine(), PICK)] }))).toBe(false)
  })

  it('sends how the quotation asks to be paid only while the tenant can take payments, and the percentage only with a percentage', () => {
    const draft = { ...salesDraftFromOrder(ORDER), payment: { mode: 'percent', percent: 30 } as const }
    expect(salesPatchBody(ORDER, draft, false).payment_to_confirm).toBeUndefined()
    expect(salesPatchBody(ORDER, draft, false, true)).toMatchObject({ payment_to_confirm: 'percent', prepayment_percent: 30 })
    expect(salesPatchBody(ORDER, { ...draft, payment: { mode: 'full', percent: 30 } }, false, true)).toMatchObject({ payment_to_confirm: 'full' })
    expect(salesPatchBody(ORDER, { ...draft, payment: { mode: 'full', percent: 30 } }, false, true).prepayment_percent).toBeUndefined()
    // A new quotation the user did not touch the payment of takes the tenant's default on the server.
    const fresh = { ...emptySalesDraft(), customerId: 5, lines: [withPickedProduct(newSalesLine(), PICK)] }
    expect(salesCreateBody(fresh, false, true).payment_to_confirm).toBeUndefined()
    expect(salesCreateBody({ ...fresh, payment: { mode: 'off', percent: 50 } }, false, true)).toMatchObject({ payment_to_confirm: 'off' })
  })

  it('reads the payment of a saved quotation and holds no percentage unless it asks for one', () => {
    expect(salesDraftFromOrder(ORDER).payment).toBeNull()
    const payment = { mode: 'full', percent: 100, currency: 'SAR', amount_required: 207, amount_received: 0, amount_due: 207, amount_to_refund: 0, amount_refundable: 0, can_refund: false, status: 'payable', link: 'ready', held: null, needs_attention: false, attention: null } as const
    expect(salesDraftFromOrder({ ...ORDER, payment }).payment).toEqual({ mode: 'full', percent: null })
    expect(salesDraftFromOrder({ ...ORDER, payment: { ...payment, mode: 'percent', percent: 25 } }).payment).toEqual({ mode: 'percent', percent: 25 })
  })

  it('gives the tenant percentage when the user moves to a percentage with none of their own, as it stands when the user chooses', () => {
    const off = { mode: 'off', percent: null } as const
    expect(salesPaymentWithDefaultPercent({ mode: 'percent', percent: null }, off, 35)).toEqual({ mode: 'percent', percent: 35 })
    expect(salesPaymentWithDefaultPercent({ mode: 'percent', percent: null }, null, 35)).toEqual({ mode: 'percent', percent: 35 })
    // A percentage the draft already holds, and a field the user emptied, are left as they are.
    expect(salesPaymentWithDefaultPercent({ mode: 'percent', percent: 25 }, off, 35)).toEqual({ mode: 'percent', percent: 25 })
    expect(salesPaymentWithDefaultPercent({ mode: 'percent', percent: null }, { mode: 'percent', percent: 25 }, 35)).toEqual({ mode: 'percent', percent: null })
    expect(salesPaymentWithDefaultPercent({ mode: 'full', percent: null }, off, 35)).toEqual({ mode: 'full', percent: null })
  })

  it('refuses a percentage that is empty or out of range, only under a percentage payment', () => {
    const base = { ...emptySalesDraft(), customerId: 1, lines: [withPickedProduct(newSalesLine(), PICK)] }
    for (const percent of [null, 0, 101, 12.5]) expect(validateSalesDraft({ ...base, payment: { mode: 'percent', percent } }).payment).toBe(true)
    for (const percent of [1, 50, 100]) expect(validateSalesDraft({ ...base, payment: { mode: 'percent', percent } }).payment).toBe(false)
    expect(validateSalesDraft({ ...base, payment: { mode: 'full', percent: null } }).payment).toBe(false)
    expect(hasSalesDraftErrors(validateSalesDraft({ ...base, payment: { mode: 'percent', percent: null } }))).toBe(true)
  })

  it('moves lines within the list and amounts a product line at the product price', () => {
    const [a, b, c] = [newSalesLine(), newSalesLine('section'), newSalesLine('note')]
    expect(moveSalesLine([a, b, c], 2, -1)).toEqual([a, c, b])
    expect(moveSalesLine([a, b, c], 0, -1)).toEqual([a, b, c])
    expect(salesLineAmount({ kind: 'product', unitPrice: 100, quantity: '3', discount: '10' })).toBe(270)
    expect(salesLineAmount({ kind: 'product', unitPrice: null, quantity: '3', discount: '0' })).toBe(0)
    expect(salesLineAmount({ kind: 'note', unitPrice: 100, quantity: '1', discount: '0' })).toBe(0)
    expect(withPickedProduct(newSalesLine(), PICK)).toMatchObject({ productId: 11, productName: 'Oil', unitPrice: 50, currency: 'SAR' })
  })

  it('tells an edit from the saved state regardless of the editor keys', () => {
    expect(salesDraftSnapshot(salesDraftFromOrder(ORDER))).toBe(salesDraftSnapshot(salesDraftFromOrder(ORDER)))
    expect(salesDraftSnapshot({ ...salesDraftFromOrder(ORDER), terms: 'x' })).not.toBe(salesDraftSnapshot(salesDraftFromOrder(ORDER)))
  })
})

describe('a quotation started from a template', () => {
  const started = { ...emptySalesDraft(), customerId: 5, templateId: 4 }

  it('needs no line of its own and sends the template instead of lines', () => {
    expect(hasSalesDraftErrors(validateSalesDraft({ ...started, lines: [] }))).toBe(false)
    expect(hasSalesDraftErrors(validateSalesDraft(started))).toBe(false)
    const body = salesCreateBody({ ...started, terms: '  Own terms ' }, false)
    expect(body).toEqual({ customer_id: 5, template_id: 4, terms: 'Own terms' })
    expect(body).not.toHaveProperty('lines')
  })

  it('is a hand-made quotation again once the template is dropped', () => {
    const dropped = { ...started, templateId: null, lines: [] }
    expect(validateSalesDraft(dropped).noLines).toBe(true)
    expect(salesCreateBody({ ...dropped, lines: [withPickedProduct(newSalesLine(), PICK)] }, false)).not.toHaveProperty('template_id')
  })

  it('is never part of a saved order', () => {
    expect(salesDraftFromOrder(ORDER).templateId).toBeNull()
  })
})

