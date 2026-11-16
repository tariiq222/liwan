import { describe, expect, it } from 'vitest'
import type { SalesTemplate } from '@liwan/contracts'
import { newSalesLine, withPickedProduct } from '../salesOrderDraft'
import { emptySalesTemplateDraft, hasSalesTemplateDraftErrors, salesTemplateBody, salesTemplateDraftFromTemplate, salesTemplateDraftSnapshot, validateSalesTemplateDraft } from '../salesTemplateDraft'
import { parseSalesTemplateQuery } from '../salesTemplateParams'

const TEMPLATE: SalesTemplate = {
  id: 4, name: 'Standard offer', validity_days: 14, archived: false, line_count: 3, usable: true, can_manage: true, terms: 'Pay within 14 days',
  lines: [
    { kind: 'section', product: null, name: 'Scope', quantity: 0, usable: true },
    { kind: 'product', product: { id: 9, name: 'Audit' }, name: '', quantity: 2, usable: true },
    { kind: 'note', product: null, name: 'Delivery within a week', quantity: 0, usable: true },
  ],
}
const PICK = { id: 11, name: 'Oil', type: 'goods' as const, unit_price: 50, amount_untaxed: 50, amount_tax: 7.5, amount_total: 57.5, currency: { id: 2, name: 'SAR', symbol: 'ر.س' } }

describe('sales template draft', () => {
  it('loads a saved template and sends it back with products and quantities only', () => {
    const draft = salesTemplateDraftFromTemplate(TEMPLATE)
    expect(draft.lines.map(line => [line.kind, line.productId, line.quantity])).toEqual([['section', null, '0'], ['product', 9, '2'], ['note', null, '0']])
    expect(salesTemplateBody(draft)).toEqual({
      name: 'Standard offer', validity_days: 14, terms: 'Pay within 14 days',
      lines: [{ kind: 'section', name: 'Scope' }, { kind: 'product', product_id: 9, quantity: 2 }, { kind: 'note', name: 'Delivery within a week' }],
    })
    const keys = JSON.stringify(salesTemplateBody(draft))
    for (const forbidden of ['price', 'discount', 'tax']) expect(keys).not.toContain(forbidden)
  })

  it('keeps the text staff wrote on a product line through an edit and sends none when there is none', () => {
    const template = { ...TEMPLATE, lines: [{ kind: 'product' as const, product: { id: 9, name: 'Audit' }, name: ' Our own wording ', quantity: 2, usable: true }, TEMPLATE.lines[1]!] }
    const draft = salesTemplateDraftFromTemplate(template)
    expect(draft.lines[0]!.name).toBe(' Our own wording ')
    expect(salesTemplateBody(draft).lines).toEqual([
      { kind: 'product', product_id: 9, quantity: 2, name: 'Our own wording' },
      { kind: 'product', product_id: 9, quantity: 2 },
    ])
  })

  it('starts empty with one product line and no validity override', () => {
    const draft = emptySalesTemplateDraft()
    expect(draft).toMatchObject({ name: '', validityDays: 0, terms: '' })
    expect(draft.lines).toHaveLength(1)
  })

  it('names what is wrong: the name, the validity, no line, and each line', () => {
    const bad = { ...emptySalesTemplateDraft(), name: '  ', validityDays: null }
    expect(validateSalesTemplateDraft(bad)).toMatchObject({ name: true, validityDays: true, noLines: false, lines: [{ product: true }] })
    expect(hasSalesTemplateDraftErrors(validateSalesTemplateDraft(bad))).toBe(true)
    expect(validateSalesTemplateDraft({ ...bad, name: 'x', validityDays: 3651 }).validityDays).toBe(true)
    expect(validateSalesTemplateDraft({ ...bad, name: 'x', validityDays: 1.5 }).validityDays).toBe(true)
    expect(validateSalesTemplateDraft({ ...bad, name: 'x', validityDays: 0, lines: [] }).noLines).toBe(true)
    const ok = { ...bad, name: 'x', validityDays: 0, lines: [withPickedProduct(newSalesLine(), PICK)] }
    expect(hasSalesTemplateDraftErrors(validateSalesTemplateDraft(ok))).toBe(false)
    expect(validateSalesTemplateDraft({ ...ok, lines: [{ ...ok.lines[0]!, quantity: '0' }] }).lines[0]).toEqual({ quantity: true })
    expect(validateSalesTemplateDraft({ ...ok, lines: [newSalesLine('section')] }).lines[0]).toEqual({ name: true })
  })

  it('tells an edit from the saved state without the editor keys', () => {
    const draft = salesTemplateDraftFromTemplate(TEMPLATE)
    expect(salesTemplateDraftSnapshot(draft)).toBe(salesTemplateDraftSnapshot(salesTemplateDraftFromTemplate(TEMPLATE)))
    expect(salesTemplateDraftSnapshot({ ...draft, name: 'Other' })).not.toBe(salesTemplateDraftSnapshot(draft))
  })
})

describe('sales template list query', () => {
  it('reads the search and the archived switch and ignores anything else and reads the page', () => {
    expect(parseSalesTemplateQuery({ q: ' offer ', archived: '1', page: '3' })).toEqual({ q: 'offer', archived: true, page: 3 })
    expect(parseSalesTemplateQuery({ archived: 'yes', page: 'x' })).toEqual({ q: '', archived: false, page: 1 })
    expect(parseSalesTemplateQuery({})).toEqual({ q: '', archived: false, page: 1 })
  })
})
