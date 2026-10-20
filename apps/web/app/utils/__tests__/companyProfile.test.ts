import { describe, expect, it } from 'vitest'
import type { CompanyProfile } from '@webvue/contracts'
import { companyPatch, profileToForm, sectionExtensions } from '../companyProfile'
import { requiredCapabilityForPath } from '../accessPolicy'

const PROFILE: CompanyProfile = {
  id: 1,
  name: 'ويب فيو',
  logo_url: null,
  report_header: null,
  company_registry: '1010000000',
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
    expect(form).toMatchObject({ name: 'ويب فيو', city: 'الرياض', state_id: 3, id_scheme: 'CRN', building_code: null })
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

  it('gates the three company pages on the read capability', () => {
    for (const page of ['profile', 'address', 'contact']) {
      expect(requiredCapabilityForPath(`/settings/company/${page}`)).toBe('settings.company.read')
    }
    expect(requiredCapabilityForPath('/settings/company/branding')).toBe('settings.branding.manage')
  })
})
