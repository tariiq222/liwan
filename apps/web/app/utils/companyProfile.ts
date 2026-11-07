import type { CompanyProfile, CompanyProfileExtension, CompanyProfilePatch } from '@liwan/contracts'

export type CompanySection = 'profile' | 'address' | 'contact'

/** The editable generic fields of each page, in their form order; installed applications add theirs as `extensions`. */
export const SECTION_FIELDS = {
  profile: ['name', 'report_header', 'company_registry', 'vat_registered', 'vat'],
  address: ['state_id', 'city', 'street2', 'street', 'zip'],
  contact: ['email', 'phone', 'website'],
} as const satisfies Record<CompanySection, readonly string[]>

/** The page that shows an extension of the profile's `identity` or `address` section. */
const EXTENSION_PAGE = { identity: 'profile', address: 'address' } as const satisfies Record<CompanyProfileExtension['section'], CompanySection>

export type CompanyForm = Record<string, string | number | boolean | null>
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
    vat_registered: profile.vat_registered,
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

// A cleared text becomes null; a boolean (the VAT registration switch) is sent as it is.
const blank = (value: FormValue | undefined): FormValue => (typeof value === 'string' ? value.trim() || null : value ?? null)

/** The PATCH body of the fields of `section` the user changed: a cleared text becomes null. */
export function companyPatch(section: CompanySection, extensions: CompanyProfileExtension[], saved: CompanyForm, draft: CompanyForm): CompanyProfilePatch {
  const patch: CompanyProfilePatch = {}
  const shown = [...SECTION_FIELDS[section], ...extensions.map(extension => extension.name)]
  for (const field of shown) {
    const value = blank(draft[field])
    if (value === blank(saved[field])) continue
    // The VAT registration switch is the one boolean of the generic profile; everything else is text or an id.
    if (field === 'vat_registered') patch.vat_registered = Boolean(value)
    else if (typeof value !== 'boolean') patch[field] = value
  }
  return patch
}

/**
 * Whether this save registers the company for VAT, or clears the number of a registered one, without a number.
 * A save that touches neither the switch nor the number is never held back by it. The server enforces the rule
 * anyway: this only says it first, under the field.
 */
export function vatNumberMissing(patch: Readonly<Record<string, unknown>>, draft: CompanyForm): boolean {
  const touched = 'vat_registered' in patch || 'vat' in patch
  return touched && Boolean(draft.vat_registered) && !String(draft.vat ?? '').trim()
}
