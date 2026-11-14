import { describe, expect, it } from 'vitest'
import { customerKeys, isCustomerListing } from '../customerKeys'
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

describe('isCustomerListing', () => {
  it('refreshes the lists and the picker after a write, not a record or the settings', () => {
    expect(isCustomerListing({ queryKey: customerKeys.list({}) })).toBe(true)
    expect(isCustomerListing({ queryKey: customerPickSearch('a').key })).toBe(true)
    expect(isCustomerListing({ queryKey: customerKeys.detail(1) })).toBe(false)
    expect(isCustomerListing({ queryKey: customerKeys.settings(1) })).toBe(false)
  })
})
