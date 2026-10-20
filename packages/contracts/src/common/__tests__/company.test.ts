import { describe, expect, it } from 'vitest'
import { CompanyLogoUploadSchema, CompanyProfilePatchSchema, CompanyProfileSchema } from '../company'

const PROFILE = {
  id: 1,
  name: 'WebVue',
  logo_url: null,
  report_header: null,
  company_registry: '1010000000',
  vat: '300000000000003',
  address: {
    street: 'King Fahd Road',
    street2: null,
    city: 'Riyadh',
    zip: '12345',
    state: { id: 3, name: 'Riyadh' },
    country: { id: 192, name: 'Saudi Arabia', code: 'SA' },
  },
  email: null,
  phone: null,
  website: null,
  currency: { id: 5, name: 'SAR', symbol: 'SAR' },
  completeness: { done: 6, total: 10 },
  extensions: [
    { name: 'building_code', section: 'address', kind: 'text', label: 'Building code', value: '1234', inputmode: 'numeric' },
    {
      name: 'id_scheme', section: 'identity', kind: 'selection', label: 'Identifier type', value: null,
      options: [{ value: 'A', label: 'Type A' }],
    },
  ],
}

describe('CompanyProfileSchema', () => {
  it('accepts the serializer shape and refuses a stray key', () => {
    expect(CompanyProfileSchema.parse(PROFILE)).toEqual(PROFILE)
    expect(CompanyProfileSchema.safeParse({ ...PROFILE, extra: 1 }).success).toBe(false)
    expect(CompanyProfileSchema.safeParse({ ...PROFILE, address: { ...PROFILE.address, extra: 1 } }).success).toBe(false)
  })

  it('refuses an extension outside the two sections or without a label', () => {
    const [text, selection] = PROFILE.extensions
    for (const extension of [{ ...text, section: 'contact' }, { ...text, kind: 'number' }, { ...text, label: '' }, { ...text, options: [] }, { ...selection, options: undefined }, { ...text, inputmode: 'loud' }]) {
      expect(CompanyProfileSchema.safeParse({ ...PROFILE, extensions: [extension] }).success).toBe(false)
    }
  })

  it('accepts an address without a state or country', () => {
    expect(CompanyProfileSchema.parse({ ...PROFILE, address: { ...PROFILE.address, state: null, country: null } })).toBeTruthy()
  })
})

describe('CompanyProfilePatchSchema', () => {
  it('accepts editable fields and null to clear', () => {
    expect(CompanyProfilePatchSchema.parse({ vat: null, state_id: null, name: 'WebVue' })).toBeTruthy()
  })

  it('refuses read-only, unknown and empty-name fields', () => {
    for (const patch of [{ currency: 'USD' }, { logo: 'x' }, { completeness: {} }, { name: '  ' }, { state_id: 0 }, { country_id: 192 }, { phone: 'x'.repeat(256) }]) {
      expect(CompanyProfilePatchSchema.safeParse(patch).success).toBe(false)
    }
  })
})

describe('CompanyLogoUploadSchema', () => {
  it('needs base64 data and nothing else', () => {
    expect(CompanyLogoUploadSchema.parse({ data: 'cG5n' })).toEqual({ data: 'cG5n' })
    expect(CompanyLogoUploadSchema.safeParse({ data: '' }).success).toBe(false)
    expect(CompanyLogoUploadSchema.safeParse({ data: 'cG5n', name: 'x' }).success).toBe(false)
  })
})
