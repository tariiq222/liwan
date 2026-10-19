import { z } from 'zod'

const text = z.string().nullable()
const ref = z.object({ id: z.number().int().positive(), name: z.string() }).strict()

/** The current company's profile (GET/PATCH/logo POST /admin/company). Saudi fields are null without l10n_sa_edi. */
export const CompanyProfileSchema = z.object({
  id: z.number().int().positive(),
  name: z.string().min(1),
  logo_url: z.string().min(1).nullable(),
  report_header: text,
  company_registry: text,
  vat: text,
  l10n_sa_edi_additional_identification_scheme: text,
  l10n_sa_edi_additional_identification_number: text,
  address: z.object({
    street: text,
    street2: text,
    city: text,
    zip: text,
    state: ref.nullable(),
    country: ref.extend({ code: text }).nullable(),
    l10n_sa_edi_building_number: text,
    l10n_sa_edi_plot_identification: text,
  }).strict(),
  email: text,
  phone: text,
  website: text,
  currency: ref.extend({ symbol: z.string() }).nullable(),
  completeness: z.object({ done: z.number().int().min(0), total: z.number().int().min(0) }).strict(),
}).strict()
export type CompanyProfile = z.infer<typeof CompanyProfileSchema>

/** PATCH /admin/company: editable fields only; null or an empty string clears an optional one, a relation is an id or null. */
export const CompanyProfilePatchSchema = z.object({
  name: z.string().trim().min(1).max(255),
  report_header: text,
  company_registry: text,
  vat: text,
  l10n_sa_edi_additional_identification_scheme: text,
  l10n_sa_edi_additional_identification_number: text,
  street: text,
  street2: text,
  city: text,
  zip: text,
  state_id: z.number().int().positive().nullable(),
  country_id: z.number().int().positive().nullable(),
  l10n_sa_edi_building_number: text,
  l10n_sa_edi_plot_identification: text,
  email: text,
  phone: text,
  website: text,
}).partial().strict()
export type CompanyProfilePatch = z.infer<typeof CompanyProfilePatchSchema>

/** POST /admin/company/logo: a PNG or JPEG of at most 2 MiB, base64 encoded. */
export const CompanyLogoUploadSchema = z.object({ data: z.string().min(1) }).strict()
export type CompanyLogoUpload = z.infer<typeof CompanyLogoUploadSchema>

/** GET /admin/company/countries and /admin/company/countries/{id}/states: the address pickers' reference lists. */
export const CompanyLookupListSchema = z.object({
  items: z.array(z.object({ id: z.number().int().positive(), name: z.string(), code: z.string() }).strict()),
  total: z.number().int().min(0),
}).strict()
export type CompanyLookupList = z.infer<typeof CompanyLookupListSchema>
