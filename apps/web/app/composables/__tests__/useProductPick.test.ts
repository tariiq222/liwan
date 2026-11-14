import { describe, expect, it } from 'vitest'
import { PRODUCT_PICK_ENDPOINT, productPickSearch } from '../useProductPick'

describe('productPickSearch', () => {
  it('searches the products pick list and drops an empty query', () => {
    expect(PRODUCT_PICK_ENDPOINT).toBe('/api/v1/products/pick')
    expect(productPickSearch('')).toEqual({ key: ['products', 'pick', ''], query: { q: undefined, limit: 50 } })
    expect(productPickSearch('شاي').query).toEqual({ q: 'شاي', limit: 50 })
  })

  it('keeps the results of different searches apart in the cache', () => {
    expect(productPickSearch('a').key).not.toEqual(productPickSearch('b').key)
  })
})
