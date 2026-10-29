import { describe, expect, it } from 'vitest'
import {
  InboxCatalogItemCreateSchema,
  InboxCatalogItemPatchSchema,
  InboxCommerceContentSchema,
  InboxMessageCommerceSchema,
  InboxOrderPatchSchema,
  InboxReplyCreateSchema,
} from '../index'

const PRODUCT = { type: 'product', body: null, footer: null, product_retailer_id: 'SHIRT-1' }
const LIST = {
  type: 'product_list',
  header: 'Offers',
  body: 'Pick',
  footer: null,
  sections: [{ title: 'Shirts', product_retailer_ids: ['a', 'b'] }],
}

describe('commerce content', () => {
  it('accepts the three shapes', () => {
    expect(InboxCommerceContentSchema.safeParse(PRODUCT).success).toBe(true)
    expect(InboxCommerceContentSchema.safeParse(LIST).success).toBe(true)
    expect(InboxCommerceContentSchema.safeParse({
      type: 'catalog_message', body: 'All', footer: null, thumbnail_product_retailer_id: null,
    }).success).toBe(true)
  })

  it('holds Meta limits', () => {
    const ids = Array.from({ length: 31 }, (_, index) => `p${index}`)
    expect(InboxCommerceContentSchema.safeParse({ ...LIST, sections: [{ title: 'a', product_retailer_ids: ids }] }).success).toBe(false)
    expect(InboxCommerceContentSchema.safeParse({ ...LIST, header: 'h'.repeat(61) }).success).toBe(false)
    expect(InboxCommerceContentSchema.safeParse({
      ...LIST, sections: [{ title: 'a', product_retailer_ids: ['x'] }, { title: 'b', product_retailer_ids: ['x'] }],
    }).success).toBe(false)
    expect(InboxCommerceContentSchema.safeParse({ ...PRODUCT, product_retailer_id: 'bad id' }).success).toBe(false)
  })

  it('is a reply member', () => {
    expect(InboxReplyCreateSchema.safeParse({ commerce: PRODUCT }).success).toBe(true)
    expect(InboxReplyCreateSchema.safeParse({ commerce: PRODUCT, body: 'x' }).success).toBe(false)
  })
})

describe('message commerce block', () => {
  it('accepts an inquiry and a cart', () => {
    expect(InboxMessageCommerceSchema.safeParse({
      type: 'inquiry', catalog_id: '300000000001', product_retailer_id: 'sku', product: null,
    }).success).toBe(true)
    expect(InboxMessageCommerceSchema.safeParse({
      type: 'order',
      catalog_id: '300000000001',
      text: null,
      lines: [{ product_retailer_id: 'sku', product: null, quantity: 1, item_price: 7.99, currency: 'SAR' }],
      order: null,
    }).success).toBe(true)
  })
})

describe('catalog item and order bodies', () => {
  it('lists an existing or a new product, never both', () => {
    expect(InboxCatalogItemCreateSchema.safeParse({ product_id: 3 }).success).toBe(true)
    expect(InboxCatalogItemCreateSchema.safeParse({ product_id: 3, product: {} }).success).toBe(false)
    expect(InboxCatalogItemPatchSchema.safeParse({}).success).toBe(false)
  })

  it('edits a cart by line id or catalog item', () => {
    expect(InboxOrderPatchSchema.safeParse({ lines: [{ id: 1, quantity: 2 }, { catalog_item_id: 4, quantity: 1 }] }).success).toBe(true)
    expect(InboxOrderPatchSchema.safeParse({ lines: [{ id: 1, quantity: 100 }] }).success).toBe(false)
  })
})
