import { describe, expect, it } from 'vitest'
import {
  CustomerCandidateListSchema,
  CustomerConflictDetailsSchema,
  CustomerCreateSchema,
  CustomerListSchema,
  CustomerPatchSchema,
  CustomerSchema,
  CustomerSettingsPatchSchema,
  CustomerSettingsSchema,
} from '../index'

const CUSTOMER = {
  id: 7, name: 'Mother', phone: '+966501234567', email: null, is_company: false,
  parent: { id: 3, name: 'Trading house' }, active: true, company: null,
}
const CANDIDATE = { id: 7, name: 'Mother', phone_last4: '4567' }

describe('CustomerSchema', () => {
  it('accepts exactly the serializer fields', () => {
    expect(CustomerSchema.parse(CUSTOMER)).toEqual(CUSTOMER)
    expect(Object.keys(CustomerSchema.shape).sort()).toEqual(
      ['active', 'company', 'email', 'id', 'is_company', 'name', 'parent', 'phone'],
    )
    expect(() => CustomerSchema.parse({ ...CUSTOMER, vat: '1' })).toThrow()
  })

  it('takes a branch company, no phone, and refuses a phone that is not E.164', () => {
    expect(CustomerSchema.parse({ ...CUSTOMER, phone: null, company: { id: 2, name: 'Branch A' } }).company).toEqual({ id: 2, name: 'Branch A' })
    expect(() => CustomerSchema.parse({ ...CUSTOMER, phone: '0501234567' })).toThrow()
    expect(() => CustomerSchema.parse({ ...CUSTOMER, parent: { id: 3 } })).toThrow()
  })

  it('wraps customers in a list envelope', () => {
    expect(CustomerListSchema.parse({ items: [CUSTOMER], total: 1 }).total).toBe(1)
    expect(() => CustomerListSchema.parse({ items: [], total: -1 })).toThrow()
  })
})

describe('CustomerCandidateSchema', () => {
  it('carries the name and the last four digits only', () => {
    expect(CustomerCandidateListSchema.parse({ items: [CANDIDATE], total: 1 }).items[0]).toEqual(CANDIDATE)
    expect(CustomerCandidateListSchema.parse({ items: [{ ...CANDIDATE, phone_last4: null }], total: 1 }).total).toBe(1)
    expect(() => CustomerCandidateListSchema.parse({ items: [{ ...CANDIDATE, phone: '+966501234567' }], total: 1 })).toThrow()
    expect(() => CustomerCandidateListSchema.parse({ items: [{ ...CANDIDATE, phone_last4: '45' }], total: 1 })).toThrow()
  })

  it('is the details of a conflict, which names at least one candidate', () => {
    expect(CustomerConflictDetailsSchema.parse({ candidates: [CANDIDATE] }).candidates).toHaveLength(1)
    expect(() => CustomerConflictDetailsSchema.parse({ candidates: [] })).toThrow()
  })
})

describe('customer writes', () => {
  it('requires a name on create and something to change on a patch', () => {
    expect(CustomerCreateSchema.parse({ name: 'Son', phone: '0501234567', create_new: true }).create_new).toBe(true)
    expect(() => CustomerCreateSchema.parse({ phone: '0501234567' })).toThrow()
    expect(() => CustomerCreateSchema.parse({ name: 'Son', company_id: 2 })).toThrow()
    expect(CustomerPatchSchema.parse({ phone: null })).toEqual({ phone: null })
    expect(() => CustomerPatchSchema.parse({})).toThrow()
    expect(() => CustomerPatchSchema.parse({ create_new: true })).toThrow()
  })
})

describe('CustomerSettingsSchema', () => {
  it('reads the sharing, the phone country and the revision', () => {
    const settings = { sharing: 'establishment', phone_country: null, revision: 1 }
    expect(CustomerSettingsSchema.parse(settings)).toEqual(settings)
    expect(CustomerSettingsSchema.parse({ ...settings, phone_country: { id: 2, code: 'AE', name: 'United Arab Emirates' } }).phone_country?.code).toBe('AE')
    expect(() => CustomerSettingsSchema.parse({ ...settings, sharing: 'group' })).toThrow()
    expect(() => CustomerSettingsSchema.parse({ ...settings, revision: 0 })).toThrow()
  })

  it('patches with the revision read and at least one setting', () => {
    expect(CustomerSettingsPatchSchema.parse({ sharing: 'branch', revision: 2 }).sharing).toBe('branch')
    expect(CustomerSettingsPatchSchema.parse({ phone_country_id: null, revision: 2 }).phone_country_id).toBeNull()
    expect(() => CustomerSettingsPatchSchema.parse({ revision: 2 })).toThrow()
    expect(() => CustomerSettingsPatchSchema.parse({ sharing: 'branch' })).toThrow()
    expect(() => CustomerSettingsPatchSchema.parse({ sharing: 'branch', revision: 2, extra: 1 })).toThrow()
  })
})
