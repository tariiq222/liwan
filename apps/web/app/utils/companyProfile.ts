import type { CompanyProfile, CompanyProfilePatch } from '@webvue/contracts'

export type CompanySection = 'profile' | 'address' | 'contact'

/** Identification schemes of the Saudi seller record (l10n_sa_edi); the label of each is `settings.company.schemes.<code>`. */
export const IDENTIFICATION_SCHEMES = ['TIN', 'CRN', 'MOM', 'MLS', '700', 'SAG', 'NAT', 'GCC', 'IQA', 'PAS', 'OTH'] as const

/** The editable fields of each page, in their form order. */
export const SECTION_FIELDS = {
  profile: ['name', 'report_header', 'company_registry', 'vat', 'l10n_sa_edi_additional_identification_scheme', 'l10n_sa_edi_additional_identification_number'],
  address: ['country_id', 'state_id', 'city', 'street2', 'street', 'zip', 'l10n_sa_edi_building_number', 'l10n_sa_edi_plot_identification'],
  contact: ['email', 'phone', 'website'],
} as const satisfies Record<CompanySection, readonly (keyof CompanyProfilePatch)[]>

type FormValue = string | number | null
export type CompanyForm = Record<keyof CompanyProfilePatch, FormValue>

/** The server profile flattened to the PATCH field names, so the form and the diff speak one vocabulary. */
export function profileToForm(profile: CompanyProfile): CompanyForm {
  const { address } = profile
  return {
    name: profile.name,
    report_header: profile.report_header,
    company_registry: profile.company_registry,
    vat: profile.vat,
    l10n_sa_edi_additional_identification_scheme: profile.l10n_sa_edi_additional_identification_scheme,
    l10n_sa_edi_additional_identification_number: profile.l10n_sa_edi_additional_identification_number,
    street: address.street,
    street2: address.street2,
    city: address.city,
    zip: address.zip,
    state_id: address.state?.id ?? null,
    country_id: address.country?.id ?? null,
    l10n_sa_edi_building_number: address.l10n_sa_edi_building_number,
    l10n_sa_edi_plot_identification: address.l10n_sa_edi_plot_identification,
    email: profile.email,
    phone: profile.phone,
    website: profile.website,
  }
}

const blank = (value: FormValue | undefined): FormValue => (typeof value === 'string' ? value.trim() || null : value ?? null)

/** The PATCH body of the fields of `section` the user changed: a cleared text becomes null. */
export function companyPatch(section: CompanySection, saved: CompanyForm, draft: CompanyForm): CompanyProfilePatch {
  const patch: Record<string, FormValue> = {}
  for (const field of SECTION_FIELDS[section]) {
    if (blank(draft[field]) !== blank(saved[field])) patch[field] = blank(draft[field])
  }
  return patch as CompanyProfilePatch
}
