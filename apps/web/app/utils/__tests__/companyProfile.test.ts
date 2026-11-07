import { describe, expect, it } from 'vitest'
import type { CompanyProfile } from '@liwan/contracts'
import { companyPatch, profileToForm, SECTION_FIELDS, sectionExtensions, vatNumberMissing } from '../companyProfile'
import { canReachPath, requiredCapabilityForPath } from '../accessPolicy'

const PROFILE: CompanyProfile = {
  id: 1,
  name: 'ليوان',
  logo_url: null,
  report_header: null,
  company_registry: '1010000000',
  vat_registered: true,
  vat: '300000000000003',
  address: {
    street: 'طريق الملك فهد',
    street2: null,
    city: 'الرياض',
    zip: null,
    state: { id: 3, name: 'الرياض' },
    country: { id: 192, name: 'السعودية', code: 'SA' },
  },
  email: null,
  phone: null,
  website: null,
  currency: { id: 5, name: 'SAR', symbol: 'SAR' },
  completeness: { done: 4, total: 10 },
  extensions: [
    { name: 'id_scheme', section: 'identity', kind: 'selection', label: 'Type', value: 'CRN', options: [{ value: 'CRN', label: 'CRN' }] },
    { name: 'building_code', section: 'address', kind: 'text', label: 'Building', value: null },
  ],
}

const profileExtensions = (section: 'profile' | 'address' | 'contact') => sectionExtensions(PROFILE, section)

describe('company profile form', () => {
  it('flattens the profile to the PATCH field names', () => {
    const form = profileToForm(PROFILE)
    expect(form).toMatchObject({ name: 'ليوان', city: 'الرياض', state_id: 3, id_scheme: 'CRN', building_code: null })
  })

  it('patches only the changed fields of the page, clearing a text with null', () => {
    const saved = profileToForm(PROFILE)
    expect(companyPatch('profile', profileExtensions('profile'), saved, { ...saved })).toEqual({})
    expect(companyPatch('profile', profileExtensions('profile'), saved, { ...saved, name: ' شركة جديدة ', company_registry: '  ' })).toEqual({ name: 'شركة جديدة', company_registry: null })
    expect(companyPatch('address', profileExtensions('address'), saved, { ...saved, state_id: null, zip: '12211' })).toEqual({ state_id: null, zip: '12211' })
  })

  it('patches an extension only on the page that shows it', () => {
    const saved = profileToForm(PROFILE)
    const draft = { ...saved, id_scheme: 'MOM', building_code: ' 77 ' }
    expect(companyPatch('profile', profileExtensions('profile'), saved, draft)).toEqual({ id_scheme: 'MOM' })
    expect(companyPatch('address', profileExtensions('address'), saved, draft)).toEqual({ building_code: '77' })
    expect(companyPatch('contact', profileExtensions('contact'), saved, draft)).toEqual({})
  })

  it('ignores a change to a field that belongs to another page', () => {
    const saved = profileToForm(PROFILE)
    expect(companyPatch('contact', profileExtensions('contact'), saved, { ...saved, name: 'x', email: 'a@b.co' })).toEqual({ email: 'a@b.co' })
  })

  it('gates the company page on the read capability and opens it to a branding-only administrator', () => {
    expect(requiredCapabilityForPath('/settings/company')).toBe('settings.company.read')
    expect(canReachPath({ capabilities: ['settings.company.read'] }, '/settings/company')).toBe(true)
    expect(canReachPath({ capabilities: ['settings.branding.manage'] }, '/settings/company')).toBe(true)
    expect(canReachPath({ capabilities: ['access.users.read'] }, '/settings/company')).toBe(false)
  })
})

describe('company VAT registration', () => {
  const unregistered: CompanyProfile = { ...PROFILE, vat_registered: false, vat: null }

  it('carries the registration switch in the profile card with the rest of the identity', () => {
    expect(SECTION_FIELDS.profile).toContain('vat_registered')
    expect(profileToForm(unregistered)).toMatchObject({ vat_registered: false, vat: null })
  })

  it('patches the switch alone and clears the number with it only when the user cleared it', () => {
    const saved = profileToForm(unregistered)
    expect(companyPatch('profile', profileExtensions('profile'), saved, { ...saved, vat_registered: true })).toEqual({ vat_registered: true })
    expect(companyPatch('profile', profileExtensions('profile'), saved, { ...saved, vat_registered: true, vat: '300000000000003' })).toEqual({ vat_registered: true, vat: '300000000000003' })
  })

  it('does not send the switch when only the VAT number changed', () => {
    const saved = profileToForm(unregistered)
    expect(companyPatch('profile', profileExtensions('profile'), saved, { ...saved, vat: '300000000000003' })).toEqual({ vat: '300000000000003' })
  })

  it('holds a save to the VAT number only when it changes the switch or the number', () => {
    const saved = profileToForm({ ...PROFILE, vat_registered: true, vat: null })
    const blank = { ...saved, vat_registered: true, vat: null }
    expect(vatNumberMissing({ name: 'x' }, blank)).toBe(false)
    expect(vatNumberMissing({ vat_registered: true }, blank)).toBe(true)
    expect(vatNumberMissing({ vat: null }, blank)).toBe(true)
    expect(vatNumberMissing({ vat_registered: true, vat: '300000000000003' }, { ...blank, vat: '300000000000003' })).toBe(false)
    expect(vatNumberMissing({ vat_registered: false }, { ...blank, vat_registered: false })).toBe(false)
  })
})
