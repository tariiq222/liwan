import { describe, expect, it } from 'vitest'
import { CompanyLogoUploadSchema, CompanyLookupListSchema, CompanyProfilePatchSchema, CompanyProfileSchema } from '../company'

const PROFILE = {
  id: 1,
  name: 'WebVue',
  logo_url: null,
  report_header: null,
  company_registry: '1010000000',
  vat: '300000000000003',
  l10n_sa_edi_additional_identification_scheme: null,
  l10n_sa_edi_additional_identification_number: null,
  address: {
    street: 'King Fahd Road',
    street2: null,
    city: 'Riyadh',
    zip: '12345',
    state: { id: 3, name: 'Riyadh' },
    country: { id: 192, name: 'Saudi Arabia', code: 'SA' },
    l10n_sa_edi_building_number: '1234',
    l10n_sa_edi_plot_identification: null,
  },
  email: null,
  phone: null,
  website: null,
  currency: { id: 5, name: 'SAR', symbol: 'SAR' },
  completeness: { done: 6, total: 10 },
}

describe('CompanyProfileSchema', () => {
  it('accepts the serializer shape and refuses a stray key', () => {
    expect(CompanyProfileSchema.parse(PROFILE)).toEqual(PROFILE)
    expect(CompanyProfileSchema.safeParse({ ...PROFILE, extra: 1 }).success).toBe(false)
    expect(CompanyProfileSchema.safeParse({ ...PROFILE, address: { ...PROFILE.address, extra: 1 } }).success).toBe(false)
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
    for (const patch of [{ currency: 'USD' }, { logo: 'x' }, { completeness: {} }, { name: '  ' }, { state_id: 0 }]) {
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

describe('CompanyLookupListSchema', () => {
  it('is the {items, total} envelope of id, name and code', () => {
    const list = { items: [{ id: 1, name: 'Saudi Arabia', code: 'SA' }], total: 1 }
    expect(CompanyLookupListSchema.parse(list)).toEqual(list)
    expect(CompanyLookupListSchema.safeParse({ items: [{ id: 1, name: 'x' }], total: 1 }).success).toBe(false)
  })
})
