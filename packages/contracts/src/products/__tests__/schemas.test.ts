import { describe, expect, it } from 'vitest'
import {
  ProductCreateSchema,
  ProductListSchema,
  ProductPatchSchema,
  ProductPickListSchema,
  ProductSchema,
  ProductSettingsPatchSchema,
  ProductSettingsSchema,
  ProductTaxChoiceListSchema,
} from '../index'

const PRICE = {
  unit_price: 100, amount_untaxed: 100, amount_tax: 15, amount_total: 115,
  currency: { id: 2, name: 'SAR', symbol: 'ر.س' },
}
const PRODUCT = {
  id: 9, name: 'Haircut', type: 'service', description: null, list_price: 100, price: PRICE,
  company: null, active: true, taxes: [{ id: 5, name: 'VAT 15%', amount: 15 }],
}
const PICK = { id: 9, name: 'Haircut', type: 'service', ...PRICE }

describe('ProductSchema', () => {
  it('accepts the serializer fields, with or without the tax contribution', () => {
    expect(ProductSchema.parse(PRODUCT)).toEqual(PRODUCT)
    const { taxes: _taxes, ...untaxed } = PRODUCT
    expect(ProductSchema.parse(untaxed).taxes).toBeUndefined()
    expect(Object.keys(ProductSchema.shape).sort()).toEqual(
      ['active', 'company', 'description', 'id', 'list_price', 'name', 'price', 'taxes', 'type'],
    )
    expect(() => ProductSchema.parse({ ...PRODUCT, image: null })).toThrow()
    expect(() => ProductSchema.parse({ ...PRODUCT, type: 'combo' })).toThrow()
    expect(() => ProductSchema.parse({ ...PRODUCT, price: { ...PRICE, currency: { id: 2, name: 'SAR' } } })).toThrow()
  })

  it('names a branch company and wraps products in a list envelope', () => {
    expect(ProductSchema.parse({ ...PRODUCT, company: { id: 3, name: 'Branch' } }).company).toEqual({ id: 3, name: 'Branch' })
    expect(ProductListSchema.parse({ items: [PRODUCT], total: 1 }).total).toBe(1)
    expect(() => ProductListSchema.parse({ items: [], total: -1 })).toThrow()
  })
})

describe('ProductPickSchema', () => {
  it('carries the name, the type and the amounts of one unit only', () => {
    expect(ProductPickListSchema.parse({ items: [PICK], total: 1 }).items[0]).toEqual(PICK)
    expect(() => ProductPickListSchema.parse({ items: [{ ...PICK, list_price: 100 }], total: 1 })).toThrow()
    expect(() => ProductPickListSchema.parse({ items: [{ ...PICK, amount_total: undefined }], total: 1 })).toThrow()
  })
})

describe('ProductCreateSchema', () => {
  it('needs a name and a type, and takes the optional price, description and taxes', () => {
    expect(ProductCreateSchema.parse({ name: 'Haircut', type: 'service' })).toEqual({ name: 'Haircut', type: 'service' })
    expect(ProductCreateSchema.parse({ name: ' Oil ', type: 'goods', list_price: 12.5, description: null, taxes: [5] }).taxes).toEqual([5])
    expect(() => ProductCreateSchema.parse({ type: 'service' })).toThrow()
    expect(() => ProductCreateSchema.parse({ name: 'Haircut' })).toThrow()
    expect(() => ProductCreateSchema.parse({ name: 'Haircut', type: 'service', list_price: -1 })).toThrow()
    expect(() => ProductCreateSchema.parse({ name: 'Haircut', type: 'service', taxes: [] })).toThrow()
    expect(() => ProductCreateSchema.parse({ name: 'Haircut', type: 'service', image: 'x' })).toThrow()
  })
})

describe('ProductPatchSchema', () => {
  it('takes any subset and refuses an empty body', () => {
    expect(ProductPatchSchema.parse({ list_price: 0 })).toEqual({ list_price: 0 })
    expect(ProductPatchSchema.parse({ description: null, taxes: [5, 6] }).taxes).toEqual([5, 6])
    expect(() => ProductPatchSchema.parse({})).toThrow()
    expect(() => ProductPatchSchema.parse({ active: false })).toThrow()
    expect(() => ProductPatchSchema.parse({ name: '' })).toThrow()
  })
})

describe('ProductTaxChoiceListSchema', () => {
  it('lists the sale taxes a product may carry', () => {
    const choice = { id: 5, name: 'VAT 15%', amount: 15, active: false }
    expect(ProductTaxChoiceListSchema.parse({ items: [choice], total: 1 }).items[0]).toEqual(choice)
    expect(() => ProductTaxChoiceListSchema.parse({ items: [{ id: 5, name: 'VAT', amount: 15 }], total: 1 })).toThrow()
  })
})

describe('ProductSettingsSchema', () => {
  it('reads the sharing mode with the revision and answers a patch that names it', () => {
    const settings = { sharing: 'establishment', can_manage: true, revision: 1 }
    expect(ProductSettingsSchema.parse(settings)).toEqual(settings)
    expect(() => ProductSettingsSchema.parse({ ...settings, sharing: 'all' })).toThrow()
    expect(ProductSettingsPatchSchema.parse({ sharing: 'branch', revision: 1 })).toEqual({ sharing: 'branch', revision: 1 })
    expect(() => ProductSettingsPatchSchema.parse({ revision: 1 })).toThrow()
    expect(() => ProductSettingsPatchSchema.parse({ sharing: 'branch' })).toThrow()
  })
})
