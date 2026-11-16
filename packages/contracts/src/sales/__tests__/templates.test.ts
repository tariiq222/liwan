import { describe, expect, it } from 'vitest'
import {
  SalesOrderCreateSchema,
  SalesSettingsPresetListSchema,
  SalesSettingsPresetSchema,
  SalesTemplateCreateSchema,
  SalesTemplateItemSchema,
  SalesTemplateListSchema,
  SalesTemplatePatchSchema,
  SalesTemplateSchema,
} from '../index'

const ITEM = { id: 4, name: 'Standard offer', validity_days: 14, archived: false, line_count: 3, usable: true, can_manage: true }
const LINES = [
  { kind: 'section', product: null, name: 'Scope', quantity: 0, usable: true },
  { kind: 'product', product: { id: 9, name: 'Audit' }, name: '', quantity: 2, usable: true },
  { kind: 'note', product: null, name: 'Delivery within a week', quantity: 0, usable: true },
]
const TEMPLATE = { ...ITEM, terms: 'Pay within 14 days', lines: LINES }

describe('quotation template wire shapes', () => {
  it('match the serializer fields and refuse any other', () => {
    expect(SalesTemplateSchema.parse(TEMPLATE)).toEqual(TEMPLATE)
    expect(Object.keys(SalesTemplateSchema.shape).sort()).toEqual(['archived', 'can_manage', 'id', 'line_count', 'lines', 'name', 'terms', 'usable', 'validity_days'])
    expect(Object.keys(SalesTemplateItemSchema.shape).sort()).toEqual(['archived', 'can_manage', 'id', 'line_count', 'name', 'usable', 'validity_days'])
    expect(SalesTemplateListSchema.parse({ items: [ITEM], total: 1 }).total).toBe(1)
    expect(() => SalesTemplateSchema.parse({ ...TEMPLATE, company_id: 1 })).toThrow()
    expect(() => SalesTemplateSchema.parse({ ...TEMPLATE, lines: [{ ...LINES[1], unit_price: 5 }] })).toThrow()
    expect(() => SalesTemplateItemSchema.parse({ ...ITEM, validity_days: -1 })).toThrow()
    expect(() => SalesTemplateItemSchema.parse({ ...ITEM, archived: undefined })).toThrow()
  })
})

describe('quotation template writes', () => {
  const product = { kind: 'product', product_id: 9, quantity: 2 }
  it('accept a name with optional validity, terms and lines', () => {
    expect(SalesTemplateCreateSchema.parse({ name: ' Offer ', validity_days: 0, terms: '', lines: [product, { kind: 'section', name: 'Scope' }] }).name).toBe('Offer')
    expect(() => SalesTemplateCreateSchema.parse({ validity_days: 3 })).toThrow()
    expect(() => SalesTemplateCreateSchema.parse({ name: '  ' })).toThrow()
    expect(() => SalesTemplateCreateSchema.parse({ name: 'x'.repeat(201) })).toThrow()
    expect(() => SalesTemplateCreateSchema.parse({ name: 'x', validity_days: 3651 })).toThrow()
    expect(() => SalesTemplateCreateSchema.parse({ name: 'x', company_id: 1 })).toThrow()
  })
  it('refuse a price, a discount, a tax or a line that mixes kinds', () => {
    for (const extra of [{ unit_price: 1 }, { discount_percent: 5 }, { tax_ids: [] }, { id: 3 }]) {
      expect(() => SalesTemplateCreateSchema.parse({ name: 'x', lines: [{ ...product, ...extra }] })).toThrow()
    }
    expect(() => SalesTemplateCreateSchema.parse({ name: 'x', lines: [{ kind: 'product', quantity: 1 }] })).toThrow()
    expect(() => SalesTemplateCreateSchema.parse({ name: 'x', lines: [{ kind: 'product', product_id: 9 }] })).toThrow()
    expect(() => SalesTemplateCreateSchema.parse({ name: 'x', lines: [{ kind: 'note' }] })).toThrow()
    expect(() => SalesTemplateCreateSchema.parse({ name: 'x', lines: [{ kind: 'note', name: 'n', quantity: 1 }] })).toThrow()
  })
  it('need something to change on an edit', () => {
    expect(SalesTemplatePatchSchema.parse({ validity_days: 7 })).toEqual({ validity_days: 7 })
    expect(() => SalesTemplatePatchSchema.parse({})).toThrow()
  })
})

describe('starting a quotation from a template', () => {
  it('takes a template id and refuses lines beside it', () => {
    expect(SalesOrderCreateSchema.parse({ customer_id: 5, template_id: 4 }).template_id).toBe(4)
    expect(() => SalesOrderCreateSchema.parse({ customer_id: 5, template_id: 4, lines: [] })).toThrow()
    expect(() => SalesOrderCreateSchema.parse({ customer_id: 5, template_id: 0 })).toThrow()
  })
})

describe('sector presets', () => {
  const values = { visibility: 'own', validity_days: 30, discount_limit_percent: 10, customer_answer: 'accept_and_sign', acceptance_confirms: false, answered_resend: 'allow', signature_methods: 'draw_or_type' }
  const preset = { key: 'services', values, matches: false }
  it('hold the values a settings write takes, and the bridge ones only when present', () => {
    expect(SalesSettingsPresetSchema.parse(preset)).toEqual(preset)
    const withBridges = { ...preset, values: { ...values, payment_to_confirm: 'off', opportunity_win: 'order_confirmed', invoice_actor: 'owner' } }
    expect(SalesSettingsPresetSchema.parse(withBridges)).toEqual(withBridges)
    expect(SalesSettingsPresetListSchema.parse({ items: [preset], total: 1 }).total).toBe(1)
  })
  it('refuse an unknown key, the default terms and a value the settings do not take', () => {
    expect(() => SalesSettingsPresetSchema.parse({ ...preset, key: 'retail' })).toThrow()
    expect(() => SalesSettingsPresetSchema.parse({ ...preset, values: { ...values, default_terms: 'x' } })).toThrow()
    expect(() => SalesSettingsPresetSchema.parse({ ...preset, values: { ...values, visibility: 'team' } })).toThrow()
    expect(() => SalesSettingsPresetSchema.parse({ ...preset, values: { visibility: 'own' } })).toThrow()
    expect(() => SalesSettingsPresetSchema.parse({ ...preset, matches: undefined })).toThrow()
  })
})
