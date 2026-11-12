import { describe, expect, it } from 'vitest'
import { ApiErrorSchema, CustomerConflictDetailsSchema } from '../../index'
import {
  InboxCatalogItemCreateSchema,
  InboxCatalogItemPatchSchema,
  InboxCommerceContentSchema,
  InboxMessageCommerceSchema,
  InboxOrderCheckoutSchema,
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

describe('InboxOrderCheckoutSchema', () => {
  it('takes the link message or template, and nothing else', () => {
    expect(InboxOrderCheckoutSchema.parse({})).toEqual({})
    expect(InboxOrderCheckoutSchema.parse({ body: 'pay here', template_id: 4 })).toEqual({ body: 'pay here', template_id: 4 })
    expect(InboxOrderCheckoutSchema.safeParse({ company_id: 1 }).success).toBe(false)
  })

  it('names the customer to use, or asks for a new one, never both', () => {
    expect(InboxOrderCheckoutSchema.parse({ customer_id: 9 })).toEqual({ customer_id: 9 })
    expect(InboxOrderCheckoutSchema.parse({ create_new: true, body: 'x' })).toEqual({ create_new: true, body: 'x' })
    expect(InboxOrderCheckoutSchema.safeParse({ customer_id: 0 }).success).toBe(false)
    expect(InboxOrderCheckoutSchema.safeParse({ create_new: 'yes' }).success).toBe(false)
    expect(InboxOrderCheckoutSchema.safeParse({ customer_id: 9, create_new: true }).success).toBe(false)
    expect(InboxOrderCheckoutSchema.safeParse({ customer_id: 9, create_new: false }).success).toBe(false)
  })

  it('reads the candidates of the 409 a matching phone answers', () => {
    const error = ApiErrorSchema.parse({
      code: 'conflict',
      message: 'customers with this phone exist',
      details: { candidates: [{ id: 5, name: 'Sara', phone_last4: '4567' }, { id: 6, name: 'Sarah', phone_last4: null }] },
    })
    expect(CustomerConflictDetailsSchema.parse(error.details).candidates.map(c => c.id)).toEqual([5, 6])
    expect(CustomerConflictDetailsSchema.safeParse({ candidates: [] }).success).toBe(false)
  })
})
