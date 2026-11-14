import { describe, expect, it } from 'vitest'
import type { Product, ProductImage } from '@liwan/contracts'
import { productCreateBody, productPatchBody, type ProductDraft } from '../productPayload'

const product: Product = {
  id: 7, name: 'باقة أساسية', type: 'service', description: 'وصف', has_image: true, list_price: 120,
  price: { unit_price: 120, amount_untaxed: 120, amount_tax: 18, amount_total: 138, currency: { id: 2, name: 'SAR', symbol: 'ر.س' } },
  company: null, active: true, taxes: [{ id: 11, name: 'VAT', amount: 15 }],
}
const image: ProductImage = { name: 'a.png', mimetype: 'image/png', data: 'AAAA' }
const saved = (): ProductDraft => ({ name: product.name, type: product.type, description: product.description ?? '', price: product.list_price, taxId: null, image: { kind: 'keep' } })
const both = { manage: true, prices: true }
const manager = { manage: true, prices: false }
const pricer = { manage: false, prices: true }

describe('productCreateBody', () => {
  it('sends the typed definition, the price only to a holder of the price right, and a single tax as [id]', () => {
    const draft: ProductDraft = { name: '  شاي  ', type: 'goods', description: '  ', price: 22, taxId: 11, image: { kind: 'set', image } }
    expect(productCreateBody(draft, both)).toEqual({ name: 'شاي', type: 'goods', list_price: 22, taxes: [11], image })
    expect(productCreateBody(draft, manager)).toEqual({ name: 'شاي', type: 'goods', taxes: [11], image })
  })

  it('leaves out an empty price, description, tax and image', () => {
    expect(productCreateBody({ name: 'x', type: 'service', description: '', price: null, taxId: null, image: { kind: 'keep' } }, both)).toEqual({ name: 'x', type: 'service' })
    expect(productCreateBody({ name: 'x', type: 'service', description: 'd', price: 0, taxId: null, image: { kind: 'remove' } }, both)).toEqual({ name: 'x', type: 'service', list_price: 0, description: 'd' })
  })
})

describe('productPatchBody', () => {
  it('sends nothing for an untouched product, and an untouched image is not sent', () => {
    expect(productPatchBody(product, saved(), both)).toEqual({})
  })

  it('sends only what changed', () => {
    expect(productPatchBody(product, { ...saved(), name: ' جديد ', description: '', price: 150 }, both)).toEqual({ name: 'جديد', description: null, list_price: 150 })
  })

  it('lets a holder of the price right alone send list_price and nothing else', () => {
    const draft: ProductDraft = { ...saved(), name: 'other', description: 'other', taxId: 12, image: { kind: 'remove' }, price: 99 }
    expect(productPatchBody(product, draft, pricer)).toEqual({ list_price: 99 })
  })

  it('never sends the price of a manager without the price right', () => {
    expect(productPatchBody(product, { ...saved(), name: 'جديد', price: 5 }, manager)).toEqual({ name: 'جديد' })
  })

  it('sends a removed image as null and a new one as the file', () => {
    expect(productPatchBody(product, { ...saved(), image: { kind: 'remove' } }, manager)).toEqual({ image: null })
    expect(productPatchBody(product, { ...saved(), image: { kind: 'set', image } }, manager)).toEqual({ image })
  })

  it('sends a single picked tax as [id], not the tax the product already has, and rewrites several only when one is picked', () => {
    expect(productPatchBody(product, { ...saved(), taxId: 12 }, manager)).toEqual({ taxes: [12] })
    expect(productPatchBody(product, { ...saved(), taxId: 11 }, manager)).toEqual({})
    const several = { ...product, taxes: [{ id: 11, name: 'VAT', amount: 15 }, { id: 12, name: 'Zero', amount: 0 }] }
    expect(productPatchBody(several, saved(), manager)).toEqual({})
    expect(productPatchBody(several, { ...saved(), taxId: 11 }, manager)).toEqual({ taxes: [11] })
  })

  it('does not send the price when it is emptied', () => {
    expect(productPatchBody(product, { ...saved(), price: null }, both)).toEqual({})
  })
})
