import { describe, expect, it } from 'vitest'
import { ApiError } from '../../useApi'
import { isSalesDiscountAboveLimit, salesFieldRef, salesFormField, salesRefusalKey } from '../salesErrors'

describe('salesFormField', () => {
  it('reads a header field and a line field of a 422', () => {
    expect(salesFormField(new ApiError(422, 'invalid', 'bad', 'customer_id'))).toEqual({ kind: 'order', field: 'customer_id' })
    expect(salesFormField(new ApiError(422, 'invalid', 'bad', 'lines.2.quantity'))).toEqual({ kind: 'line', index: 2, field: 'quantity' })
  })

  it('reads the line of a discount above the limit, and nothing for other refusals', () => {
    const discount = new ApiError(403, 'forbidden', 'no', 'lines.0.discount_percent', { reason: 'discount_above_limit' })
    expect(isSalesDiscountAboveLimit(discount)).toBe(true)
    expect(salesFormField(discount)).toEqual({ kind: 'line', index: 0, field: 'discount_percent' })
    expect(salesFormField(new ApiError(403, 'forbidden', 'no', 'customer_id'))).toBeNull()
    expect(salesFormField(new ApiError(422, 'invalid', 'bad', 'lines.x.quantity'))).toBeNull()
    expect(salesFieldRef('lines.1.unit_price')).toBeNull()
    expect(salesFieldRef(undefined)).toBeNull()
  })
})

describe('salesRefusalKey', () => {
  it('names the refusals the screens explain', () => {
    expect(salesRefusalKey(new ApiError(403, 'forbidden', 'no', undefined, { reason: 'discount_above_limit' }))).toBe('sales.errors.discountAboveLimit')
    expect(salesRefusalKey(new ApiError(403, 'transition_forbidden', 'no'))).toBe('sales.errors.transitionForbidden')
    expect(salesRefusalKey(new ApiError(403, 'feature_not_included', 'no'))).toBe('sales.errors.featureNotIncluded')
    expect(salesRefusalKey(new ApiError(403, 'forbidden', 'no'))).toBe('sales.errors.forbidden')
    expect(salesRefusalKey(new ApiError(404, 'not_found', 'no'))).toBe('sales.errors.notFound')
    expect(salesRefusalKey(new ApiError(409, 'conflict', 'no'))).toBe('sales.errors.conflict')
    expect(salesRefusalKey(new ApiError(500, 'unavailable', 'down'))).toBeNull()
  })
})
