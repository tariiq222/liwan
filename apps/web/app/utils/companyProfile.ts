import type { CompanyProfile, CompanyProfileExtension, CompanyProfilePatch } from '@webvue/contracts'

export type CompanySection = 'profile' | 'address' | 'contact'

/** The editable generic fields of each page, in their form order; installed applications add theirs as `extensions`. */
export const SECTION_FIELDS = {
  profile: ['name', 'report_header', 'company_registry', 'vat'],
  address: ['state_id', 'city', 'street2', 'street', 'zip'],
  contact: ['email', 'phone', 'website'],
} as const satisfies Record<CompanySection, readonly string[]>

/** The page that shows an extension of the profile's `identity` or `address` section. */
const EXTENSION_PAGE = { identity: 'profile', address: 'address' } as const satisfies Record<CompanyProfileExtension['section'], CompanySection>

export type CompanyForm = Record<string, string | number | null>
type FormValue = CompanyForm[string]

/** The extensions of `profile` shown on `section`. */
export function sectionExtensions(profile: CompanyProfile, section: CompanySection): CompanyProfileExtension[] {
  return profile.extensions.filter(extension => EXTENSION_PAGE[extension.section] === section)
}

/** The server profile flattened to the PATCH field names, so the form and the diff speak one vocabulary. */
export function profileToForm(profile: CompanyProfile): CompanyForm {
  const { address } = profile
  return {
    name: profile.name,
    report_header: profile.report_header,
    company_registry: profile.company_registry,
    vat: profile.vat,
    street: address.street,
    street2: address.street2,
    city: address.city,
    zip: address.zip,
    state_id: address.state?.id ?? null,
    email: profile.email,
    phone: profile.phone,
    website: profile.website,
    ...Object.fromEntries(profile.extensions.map(extension => [extension.name, extension.value])),
  }
}

const blank = (value: FormValue | undefined): FormValue => (typeof value === 'string' ? value.trim() || null : value ?? null)

/** The PATCH body of the fields of `section` the user changed: a cleared text becomes null. */
export function companyPatch(section: CompanySection, extensions: CompanyProfileExtension[], saved: CompanyForm, draft: CompanyForm): CompanyProfilePatch {
  const patch: CompanyForm = {}
  const shown = [...SECTION_FIELDS[section], ...extensions.map(extension => extension.name)]
  for (const field of shown) {
    if (blank(draft[field]) !== blank(saved[field])) patch[field] = blank(draft[field])
  }
  return patch
}
