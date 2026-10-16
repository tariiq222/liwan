import { describe, expect, it } from 'vitest'
import { buildVendorPolicy } from '../vendorPolicy'

describe('vendor numeric policy form', () => {
  it.each([25, '25'])('preserves the numeric input value %s and untouched policy fields', value => {
    expect(buildVendorPolicy([['users.limit', 'limit']], { 'users.limit': null, 'pmo.enabled': true }, { 'users.limit': value }))
      .toEqual({ 'users.limit': 25, 'pmo.enabled': true })
  })
  it('distinguishes zero and unlimited', () => {
    expect(buildVendorPolicy([['users.limit', 'limit'], ['storage.limit_mb', 'limit']], {}, { 'users.limit': 0, 'storage.limit_mb': '' }))
      .toEqual({ 'users.limit': 0, 'storage.limit_mb': null })
  })
  it.each([-1, 1.5, Infinity, 'oops'])('rejects invalid limits %s', value => {
    expect(() => buildVendorPolicy([['users.limit', 'limit']], {}, { 'users.limit': value })).toThrow('Invalid feature limit')
  })
})
