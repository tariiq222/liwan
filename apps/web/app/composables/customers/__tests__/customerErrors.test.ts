import { describe, expect, it } from 'vitest'
import { ApiError } from '../../useApi'
import { customerConflictCandidates, customerFieldRemoval, customerFormField, customerRemovalKind, customerPropertyError, isSharingTransferRequired } from '../customerErrors'

const candidates = [{ id: 7, name: 'منى العتيبي', phone_last4: '4567' }, { id: 9, name: 'مؤسسة العتيبي', phone_last4: null }]

describe('customerConflictCandidates', () => {
  it('returns the customers a create answered with, in the server order', () => {
    expect(customerConflictCandidates(new ApiError(409, 'conflict', 'x', undefined, { candidates }))).toEqual(candidates)
  })

  it('ignores any other refusal, including a stale settings revision and malformed details', () => {
    expect(customerConflictCandidates(new ApiError(409, 'conflict', 'x'))).toBeNull()
    expect(customerConflictCandidates(new ApiError(409, 'conflict', 'x', undefined, { candidates: [{ id: 1, name: 'a', phone_last4: '12345678' }] }))).toBeNull()
    expect(customerConflictCandidates(new ApiError(422, 'invalid', 'x', undefined, { candidates }))).toBeNull()
    expect(customerConflictCandidates(new Error('offline'))).toBeNull()
  })
})

describe('customerFormField', () => {
  it('maps invalid_phone to the phone field and party_kind_not_allowed to the party kind', () => {
    expect(customerFormField(new ApiError(422, 'invalid_phone', 'x', 'phone'))).toBe('phone')
    expect(customerFormField(new ApiError(422, 'invalid', 'x', 'is_company', { reason: 'party_kind_not_allowed' }))).toBe('is_company')
  })

  it('maps a refused parent company to the parent field', () => {
    expect(customerFormField(new ApiError(422, 'invalid', 'x', 'parent_id'))).toBe('parent_id')
  })

  it('leaves every other refusal at the top of the form', () => {
    expect(customerFormField(new ApiError(422, 'invalid', 'x', 'name'))).toBeNull()
    expect(customerFormField(new ApiError(403, 'forbidden', 'x', 'phone'))).toBeNull()
    expect(customerFormField(null)).toBeNull()
  })
})

describe('customerPropertyError', () => {
  it('names the custom field a refusal belongs to', () => {
    expect(customerPropertyError(new ApiError(422, 'invalid', 'x', 'properties.city'))).toEqual({ key: 'city' })
    expect(customerPropertyError(new ApiError(422, 'invalid', 'x', 'name'))).toBeNull()
  })
})

describe('customerFieldRemoval', () => {
  const fields = [{ key: 'city', label: 'المدينة', count: 12 }]
  const options = [{ field_key: 'tier', field_label: 'الفئة', key: 'gold', label: 'ذهبي', count: 3 }]

  it('returns the removed fields and the removed options with the number of customers that lose a value', () => {
    expect(customerFieldRemoval(new ApiError(409, 'custom_field_values_exist', 'x', undefined, { fields, options: [] }))).toEqual({ fields, options: [] })
    expect(customerFieldRemoval(new ApiError(409, 'custom_field_values_exist', 'x', undefined, { fields: [], options }))).toEqual({ fields: [], options })
    expect(customerFieldRemoval(new ApiError(409, 'custom_field_values_exist', 'x', undefined, { fields, options }))).toEqual({ fields, options })
  })

  it('ignores other 409s and details of another shape', () => {
    expect(customerFieldRemoval(new ApiError(409, 'conflict', 'x', undefined, { fields, options: [] }))).toBeNull()
    expect(customerFieldRemoval(new ApiError(409, 'custom_field_values_exist', 'x', undefined, { fields: [], options: [] }))).toBeNull()
    expect(customerFieldRemoval(new ApiError(409, 'custom_field_values_exist', 'x', undefined, { fields }))).toBeNull()
  })
})

describe('customerRemovalKind', () => {
  it('names what the write removes: only fields, only options or both', () => {
    const fields = [{ key: 'city', label: 'المدينة', count: 12 }]
    const options = [{ field_key: 'tier', field_label: 'الفئة', key: 'gold', label: 'ذهبي', count: 3 }]
    expect(customerRemovalKind({ fields, options: [] })).toBe('fields')
    expect(customerRemovalKind({ fields: [], options })).toBe('options')
    expect(customerRemovalKind({ fields, options })).toBe('both')
  })
})

describe('isSharingTransferRequired', () => {
  it('recognises only the sharing refusal', () => {
    expect(isSharingTransferRequired(new ApiError(409, 'sharing_transfer_required', 'x', 'sharing'))).toBe(true)
    expect(isSharingTransferRequired(new ApiError(409, 'conflict', 'x'))).toBe(false)
  })
})
