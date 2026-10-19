import { describe, expect, it } from 'vitest'
import type { CompanyProfile } from '@webvue/contracts'
import { companyPatch, profileToForm } from '../companyProfile'
import { requiredCapabilityForPath } from '../accessPolicy'

const PROFILE: CompanyProfile = {
  id: 1,
  name: 'ويب فيو',
  logo_url: null,
  report_header: null,
  company_registry: '1010000000',
  vat: '300000000000003',
  l10n_sa_edi_additional_identification_scheme: 'CRN',
  l10n_sa_edi_additional_identification_number: null,
  address: {
    street: 'طريق الملك فهد',
    street2: null,
    city: 'الرياض',
    zip: null,
    state: { id: 3, name: 'الرياض' },
    country: { id: 192, name: 'السعودية', code: 'SA' },
    l10n_sa_edi_building_number: null,
    l10n_sa_edi_plot_identification: null,
  },
  email: null,
  phone: null,
  website: null,
  currency: { id: 5, name: 'SAR', symbol: 'SAR' },
  completeness: { done: 4, total: 10 },
}

describe('company profile form', () => {
  it('flattens the profile to the PATCH field names', () => {
    const form = profileToForm(PROFILE)
    expect(form).toMatchObject({ name: 'ويب فيو', city: 'الرياض', state_id: 3, country_id: 192, l10n_sa_edi_additional_identification_scheme: 'CRN' })
  })

  it('patches only the changed fields of the page, clearing a text with null', () => {
    const saved = profileToForm(PROFILE)
    expect(companyPatch('profile', saved, { ...saved })).toEqual({})
    expect(companyPatch('profile', saved, { ...saved, name: ' شركة جديدة ', company_registry: '  ' })).toEqual({ name: 'شركة جديدة', company_registry: null })
    expect(companyPatch('address', saved, { ...saved, state_id: null, zip: '12211' })).toEqual({ state_id: null, zip: '12211' })
  })

  it('ignores a change to a field that belongs to another page', () => {
    const saved = profileToForm(PROFILE)
    expect(companyPatch('contact', saved, { ...saved, name: 'x', email: 'a@b.co' })).toEqual({ email: 'a@b.co' })
  })

  it('gates the three company pages on the read capability', () => {
    for (const page of ['profile', 'address', 'contact']) {
      expect(requiredCapabilityForPath(`/settings/company/${page}`)).toBe('settings.company.read')
    }
    expect(requiredCapabilityForPath('/settings/company/branding')).toBe('settings.branding.manage')
  })
})
