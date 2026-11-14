import { describe, expect, it } from 'vitest'
import type { ProductPick, SalesOrder } from '@liwan/contracts'
import {
  emptySalesDraft, hasSalesDraftErrors, moveSalesLine, newSalesLine, salesCreateBody, salesDraftFromOrder, salesDraftSnapshot,
  salesLinePreview, salesPatchBody, validateSalesDraft, withPickedProduct,
} from '../salesOrderDraft'

const currency = { id: 2, name: 'SAR', symbol: 'ر.س' }
const ORDER: SalesOrder = {
  id: 7, number: 'S00007', state: 'draft', locked: false, source: 'staff', customer: { id: 5, name: 'Acme' },
  salesperson: { id: 2, name: 'Maha', user_id: 2 }, validity_date: '2026-12-14', date: '2026-11-14T08:00:00Z', terms: 'Net 30', currency,
  amount_untaxed: 180, amount_tax: 27, amount_total: 207,
  lines: [
    { id: 3, kind: 'section', product: null, name: 'Services', quantity: 0, unit: null, unit_price: 0, discount_percent: 0, amount_untaxed: 0, amount_tax: 0, amount_total: 0 },
    { id: 4, kind: 'product', product: { id: 9, name: 'Haircut' }, name: 'Haircut', quantity: 2, unit: 'Units', unit_price: 100, discount_percent: 10, amount_untaxed: 180, amount_tax: 27, amount_total: 207 },
  ],
  actions: { edit: true, confirm: true, cancel: true, reopen: false, lock: false, unlock: false, duplicate: true, assign: false },
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
    expect(errors).toEqual({ customer: true, noLines: false, lines: [{ product: true }, { name: true }, { quantity: true, discount: true }] })
    expect(hasSalesDraftErrors(errors)).toBe(true)
    expect(validateSalesDraft({ ...emptySalesDraft(), customerId: 1, lines: [] }).noLines).toBe(true)
    expect(hasSalesDraftErrors(validateSalesDraft({ ...emptySalesDraft(), customerId: 1, lines: [withPickedProduct(newSalesLine(), PICK)] }))).toBe(false)
  })

  it('moves lines within the list and previews a product line before tax', () => {
    const [a, b, c] = [newSalesLine(), newSalesLine('section'), newSalesLine('note')]
    expect(moveSalesLine([a, b, c], 2, -1)).toEqual([a, c, b])
    expect(moveSalesLine([a, b, c], 0, -1)).toEqual([a, b, c])
    expect(salesLinePreview({ kind: 'product', unitPrice: 100, quantity: '3', discount: '10' })).toBe(270)
    expect(salesLinePreview({ kind: 'product', unitPrice: null, quantity: '3', discount: '0' })).toBe(0)
    expect(salesLinePreview({ kind: 'note', unitPrice: 100, quantity: '1', discount: '0' })).toBe(0)
    expect(withPickedProduct(newSalesLine(), PICK)).toMatchObject({ productId: 11, productName: 'Oil', unitPrice: 50, currency: 'SAR' })
  })

  it('tells an edit from the saved state regardless of the editor keys', () => {
    expect(salesDraftSnapshot(salesDraftFromOrder(ORDER))).toBe(salesDraftSnapshot(salesDraftFromOrder(ORDER)))
    expect(salesDraftSnapshot({ ...salesDraftFromOrder(ORDER), terms: 'x' })).not.toBe(salesDraftSnapshot(salesDraftFromOrder(ORDER)))
  })
})
