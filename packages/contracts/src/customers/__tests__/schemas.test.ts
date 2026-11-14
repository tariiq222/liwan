import { describe, expect, it } from 'vitest'
import {
  CustomerCandidateListSchema,
  CustomerConflictDetailsSchema,
  CustomerCountryListSchema,
  CustomerCreateSchema,
  CustomerFieldRemovalDetailsSchema,
  CustomerListSchema,
  CustomerPatchSchema,
  CustomerSchema,
  CustomerSettingsPatchSchema,
  CustomerSettingsSchema,
} from '../index'

const CUSTOMER = {
  id: 7, name: 'Mother', erased: false, phone: '+966501234567', email: null, is_company: false,
  parent: { id: 3, name: 'Trading house' }, active: true, company: null,
  properties: [{ key: 'tier', label: 'Tier', type: 'selection', options: [{ key: 'gold', label: 'Gold' }], value: 'gold' }],
}
const CANDIDATE = { id: 7, name: 'Mother', phone_last4: '4567' }

describe('CustomerSchema', () => {
  it('accepts exactly the serializer fields', () => {
    expect(CustomerSchema.parse(CUSTOMER)).toEqual(CUSTOMER)
    expect(Object.keys(CustomerSchema.shape).sort()).toEqual(
      ['active', 'company', 'email', 'erased', 'id', 'is_company', 'name', 'parent', 'phone', 'properties'],
    )
    expect(() => CustomerSchema.parse({ ...CUSTOMER, properties: [{ key: 'tier', label: 'Tier', type: 'selection', value: 'gold' }] })).toThrow()
    expect(() => CustomerSchema.parse({ ...CUSTOMER, vat: '1' })).toThrow()
  })

  it('marks an erased customer with a boolean and requires it', () => {
    expect(CustomerSchema.parse({ ...CUSTOMER, erased: true }).erased).toBe(true)
    const { erased: _erased, ...withoutFlag } = CUSTOMER
    expect(() => CustomerSchema.parse(withoutFlag)).toThrow()
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

  it('sets only the customer fields it names, and null clears one', () => {
    expect(CustomerCreateSchema.parse({ name: 'Son', properties: { tier: 'gold' } }).properties).toEqual({ tier: 'gold' })
    expect(CustomerPatchSchema.parse({ properties: { tier: null } })).toEqual({ properties: { tier: null } })
    expect(() => CustomerPatchSchema.parse({ properties: { tier: { key: 'gold' } } })).toThrow()
  })
})

describe('CustomerSettingsSchema', () => {
  const FIELD = { key: 'tier', label: 'Tier', type: 'selection', options: [{ key: 'gold', label: 'Gold' }] }
  const settings = {
    sharing: 'establishment', party_kinds: 'both', phone_country: null, fields: [FIELD],
    field_limits: { max_properties: 50, max_options: 100, max_label: 64 }, can_manage: true, revision: 1,
  }

  it('reads every setting, the customer fields, whether the session may change them and the revision', () => {
    expect(CustomerSettingsSchema.parse(settings)).toEqual(settings)
    expect(CustomerSettingsSchema.parse({ ...settings, phone_country: { id: 2, code: 'AE', name: 'United Arab Emirates' } }).phone_country?.code).toBe('AE')
    expect(CustomerSettingsSchema.parse({ ...settings, can_manage: false, fields: [] }).can_manage).toBe(false)
    expect(() => CustomerSettingsSchema.parse({ ...settings, sharing: 'group' })).toThrow()
    expect(() => CustomerSettingsSchema.parse({ ...settings, party_kinds: 'vendors' })).toThrow()
    expect(() => CustomerSettingsSchema.parse({ ...settings, revision: 0 })).toThrow()
    expect(() => CustomerSettingsSchema.parse({ ...settings, fields: [{ ...FIELD, options: [] }] })).toThrow()
  })

  it('patches with the revision read and at least one setting', () => {
    expect(CustomerSettingsPatchSchema.parse({ sharing: 'branch', revision: 2 }).sharing).toBe('branch')
    expect(CustomerSettingsPatchSchema.parse({ party_kinds: 'companies', revision: 2 }).party_kinds).toBe('companies')
    expect(CustomerSettingsPatchSchema.parse({ phone_country_id: null, revision: 2 }).phone_country_id).toBeNull()
    expect(() => CustomerSettingsPatchSchema.parse({ revision: 2 })).toThrow()
    expect(() => CustomerSettingsPatchSchema.parse({ sharing: 'branch' })).toThrow()
    expect(() => CustomerSettingsPatchSchema.parse({ sharing: 'branch', revision: 2, extra: 1 })).toThrow()
  })

  it('sends the whole field definition, a new field without a key, and confirms a removal only with fields', () => {
    const patch = { fields: [FIELD, { label: 'Note', type: 'char' }], revision: 2 }
    expect(CustomerSettingsPatchSchema.parse(patch).fields).toHaveLength(2)
    expect(CustomerSettingsPatchSchema.parse({ fields: [], confirm_field_removal: true, revision: 2 }).confirm_field_removal).toBe(true)
    expect(() => CustomerSettingsPatchSchema.parse({ confirm_field_removal: true, revision: 2 })).toThrow()
    expect(() => CustomerSettingsPatchSchema.parse({ fields: [], confirm_field_removal: false, revision: 2 })).toThrow()
  })

  it('lists the countries a phone can be read in', () => {
    const countries = { items: [{ id: 2, code: 'AE', name: 'United Arab Emirates' }], total: 1 }
    expect(CustomerCountryListSchema.parse(countries)).toEqual(countries)
    expect(() => CustomerCountryListSchema.parse({ items: [{ id: 2, code: 'ARE', name: 'United Arab Emirates' }], total: 1 })).toThrow()
  })

  it('names each removed field and each removed option that customers still hold, with their count', () => {
    const field = { key: 'tier', label: 'Tier', count: 3 }
    const option = { field_key: 'segment', field_label: 'Segment', key: 'gold', label: 'Gold', count: 2 }
    expect(CustomerFieldRemovalDetailsSchema.parse({ fields: [field], options: [] })).toEqual({ fields: [field], options: [] })
    expect(CustomerFieldRemovalDetailsSchema.parse({ fields: [], options: [option] }).options[0]?.count).toBe(2)
    expect(() => CustomerFieldRemovalDetailsSchema.parse({ fields: [], options: [] })).toThrow()
    expect(() => CustomerFieldRemovalDetailsSchema.parse({ fields: [field] })).toThrow()
    expect(() => CustomerFieldRemovalDetailsSchema.parse({ fields: [{ ...field, count: 0 }], options: [] })).toThrow()
    expect(() => CustomerFieldRemovalDetailsSchema.parse({ fields: [], options: [{ ...option, field_label: '' }] })).toThrow()
  })
})
