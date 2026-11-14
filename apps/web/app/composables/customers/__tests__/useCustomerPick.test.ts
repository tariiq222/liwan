import { describe, expect, it } from 'vitest'
import { CUSTOMER_PICK_ENDPOINT, customerPickSearch } from '../useCustomerPick'

describe('customerPickSearch', () => {
  it('searches the customers pick list and drops an empty query', () => {
    expect(CUSTOMER_PICK_ENDPOINT).toBe('/api/v1/customers/pick')
    expect(customerPickSearch('')).toEqual({ key: ['customers', 'pick', ''], query: { q: undefined, limit: 50 } })
    expect(customerPickSearch('أكمي').query).toEqual({ q: 'أكمي', limit: 50 })
  })

  it('keeps the results of different searches apart in the cache', () => {
    expect(customerPickSearch('a').key).not.toEqual(customerPickSearch('b').key)
  })
})
