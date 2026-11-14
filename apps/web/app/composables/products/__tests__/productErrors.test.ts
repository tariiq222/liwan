import { describe, expect, it } from 'vitest'
import { ApiError } from '../../useApi'
import { isProductSharingTransferRequired, productFormField, productManagedReason, productAlertVisible, type ProductFormField } from '../productErrors'

describe('productFormField', () => {
  it('names the form field a 422 belongs to', () => {
    expect(productFormField(new ApiError(422, 'invalid', 'bad', 'list_price'))).toBe('list_price')
    expect(productFormField(new ApiError(422, 'invalid', 'bad', 'taxes'))).toBe('taxes')
  })

  it('is null for a field the form has not, a field-less 422 and any other status', () => {
    expect(productFormField(new ApiError(422, 'invalid', 'bad', 'colour'))).toBeNull()
    expect(productFormField(new ApiError(422, 'invalid', 'bad'))).toBeNull()
    expect(productFormField(new ApiError(403, 'forbidden', 'no', 'name'))).toBeNull()
  })
})

describe('productAlertVisible', () => {
  const rendered = new Set<ProductFormField>(['name', 'list_price'])

  it('shows a refusal at the top unless the field that owns it is on the form', () => {
    expect(productAlertVisible(null, rendered)).toBe(false)
    expect(productAlertVisible(new ApiError(422, 'invalid', 'bad', 'name'), rendered)).toBe(false)
    expect(productAlertVisible(new ApiError(422, 'invalid', 'bad', 'taxes'), rendered)).toBe(true)
    expect(productAlertVisible(new ApiError(500, 'unavailable', 'down'), rendered)).toBe(true)
  })
})

describe('productManagedReason', () => {
  it('reads the D23 reason of a 403', () => {
    expect(productManagedReason(new ApiError(403, 'forbidden', 'no', undefined, { reason: 'managed_in_root_company' }))).toBe('managed_in_root_company')
    expect(productManagedReason(new ApiError(403, 'forbidden', 'no', undefined, { reason: 'managed_in_branch' }))).toBe('managed_in_branch')
  })

  it('is null for a 403 without a known reason and for other statuses', () => {
    expect(productManagedReason(new ApiError(403, 'forbidden', 'no'))).toBeNull()
    expect(productManagedReason(new ApiError(403, 'forbidden', 'no', undefined, { reason: 'other' }))).toBeNull()
    expect(productManagedReason(new ApiError(409, 'conflict', 'no', undefined, { reason: 'managed_in_branch' }))).toBeNull()
  })
})

describe('isProductSharingTransferRequired', () => {
  it('is true for the 409 of that code only', () => {
    expect(isProductSharingTransferRequired(new ApiError(409, 'sharing_transfer_required', 'products exist', 'sharing'))).toBe(true)
    expect(isProductSharingTransferRequired(new ApiError(409, 'conflict', 'stale'))).toBe(false)
  })
})
