import { z } from 'zod'

const text = z.string().nullable()
// What the server accepts per text field of a PATCH.
const patchText = z.string().max(255).nullable()
const ref = z.object({ id: z.number().int().positive(), name: z.string() }).strict()

/**
 * A profile field an installed application adds to the generic profile: shown in its `section`, labelled by the
 * server in the user's language, written back under its `name`. A `selection` carries its `options`.
 */
const extensionBase = {
  name: z.string().min(1),
  section: z.enum(['identity', 'address']),
  label: z.string().min(1),
  value: text,
  inputmode: z.enum(['numeric', 'decimal', 'tel', 'email', 'url']).optional(),
}
export const CompanyProfileExtensionSchema = z.discriminatedUnion('kind', [
  z.object({ ...extensionBase, kind: z.literal('text') }).strict(),
  z.object({
    ...extensionBase,
    kind: z.literal('selection'),
    options: z.array(z.object({ value: z.string(), label: z.string() }).strict()),
  }).strict(),
])
export type CompanyProfileExtension = z.infer<typeof CompanyProfileExtensionSchema>

/** The current company's profile (GET/PATCH/logo POST /admin/company). */
export const CompanyProfileSchema = z.object({
  id: z.number().int().positive(),
  name: z.string().min(1),
  logo_url: z.string().min(1).nullable(),
  report_header: text,
  company_registry: text,
  vat: text,
  address: z.object({
    street: text,
    street2: text,
    city: text,
    zip: text,
    state: ref.nullable(),
    country: ref.extend({ code: text }).nullable(),
  }).strict(),
  email: text,
  phone: text,
  website: text,
  currency: ref.extend({ symbol: z.string() }).nullable(),
  completeness: z.object({ done: z.number().int().min(0), total: z.number().int().min(0) }).strict(),
  extensions: z.array(CompanyProfileExtensionSchema),
}).strict()
export type CompanyProfile = z.infer<typeof CompanyProfileSchema>

/**
 * PATCH /admin/company: the generic editable fields only; null or an empty string clears an optional one, the state is an
 * id or null. The schema covers just that generic part: the server also accepts each `extensions` field of the profile,
 * flat by its name, so `CompanyProfilePatch` adds a string-or-null entry per extension name.
 */
export const CompanyProfilePatchSchema = z.object({
  name: z.string().trim().min(1).max(255),
  report_header: patchText,
  company_registry: patchText,
  vat: patchText,
  street: patchText,
  street2: patchText,
  city: patchText,
  zip: patchText,
  state_id: z.number().int().positive().nullable(),
  email: patchText,
  phone: patchText,
  website: patchText,
}).partial().strict()
export type CompanyProfilePatch = z.infer<typeof CompanyProfilePatchSchema> & { [extensionName: string]: string | number | null | undefined }

/** POST /admin/company/logo: a PNG or JPEG of at most 2 MiB, base64 encoded. */
export const CompanyLogoUploadSchema = z.object({ data: z.string().min(1) }).strict()
export type CompanyLogoUpload = z.infer<typeof CompanyLogoUploadSchema>
