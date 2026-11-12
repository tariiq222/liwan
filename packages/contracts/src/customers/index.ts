import { z } from 'zod'

// liwan_customers: the commercial party (customer or vendor) on res.partner, owned by one shared service.
// Field for field with odoo-addons/liwan_customers/serializers/{customer,settings}.py.

const RefSchema = z.object({ id: z.number().int().positive(), name: z.string() }).strict()

export const CustomerSharingSchema = z.enum(['establishment', 'branch'])

/** A customer on the wire. `company` is null for a customer shared by every branch. Phones are E.164. */
export const CustomerSchema = z.object({
  id: z.number().int().positive(),
  name: z.string().min(1),
  phone: z.string().regex(/^\+[1-9]\d{6,14}$/).nullable(),
  email: z.string().nullable(),
  is_company: z.boolean(),
  parent: RefSchema.nullable(),
  active: z.boolean(),
  company: RefSchema.nullable(),
}).strict()

export const CustomerListSchema = z.object({
  items: z.array(CustomerSchema),
  total: z.number().int().nonnegative(),
}).strict()

/** What a holder of a pick capability sees of a customer: its name and the last four digits of its phone. */
export const CustomerCandidateSchema = z.object({
  id: z.number().int().positive(),
  name: z.string().min(1),
  phone_last4: z.string().regex(/^\d{4}$/).nullable(),
}).strict()

export const CustomerCandidateListSchema = z.object({
  items: z.array(CustomerCandidateSchema),
  total: z.number().int().nonnegative(),
}).strict()

/** `details` of the 409 `conflict` a create answers while customers share the phone and `create_new` is not set. */
export const CustomerConflictDetailsSchema = z.object({
  candidates: z.array(CustomerCandidateSchema).min(1),
}).strict()

const IdentityFields = {
  phone: z.string().min(1).nullable().optional(),
  email: z.string().min(1).max(254).nullable().optional(),
  is_company: z.boolean().optional(),
  parent_id: z.number().int().positive().nullable().optional(),
}

export const CustomerCreateSchema = z.object({
  name: z.string().min(1).max(200),
  ...IdentityFields,
  create_new: z.boolean().optional(),
}).strict()

export const CustomerPatchSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  ...IdentityFields,
}).strict().refine((patch) => Object.keys(patch).length > 0, { message: 'nothing to change' })

export const CustomerSettingsSchema = z.object({
  sharing: CustomerSharingSchema,
  phone_country: z.object({
    id: z.number().int().positive(),
    code: z.string().length(2),
    name: z.string(),
  }).strict().nullable(),
  revision: z.number().int().positive(),
}).strict()

export const CustomerSettingsPatchSchema = z.object({
  sharing: CustomerSharingSchema.optional(),
  phone_country_id: z.number().int().positive().nullable().optional(),
  revision: z.number().int().positive(),
}).strict().refine((patch) => Object.keys(patch).length > 1, { message: 'nothing to change' })

export type CustomerSharing = z.infer<typeof CustomerSharingSchema>
export type Customer = z.infer<typeof CustomerSchema>
export type CustomerList = z.infer<typeof CustomerListSchema>
export type CustomerCandidate = z.infer<typeof CustomerCandidateSchema>
export type CustomerCandidateList = z.infer<typeof CustomerCandidateListSchema>
export type CustomerConflictDetails = z.infer<typeof CustomerConflictDetailsSchema>
export type CustomerCreate = z.infer<typeof CustomerCreateSchema>
export type CustomerPatch = z.infer<typeof CustomerPatchSchema>
export type CustomerSettings = z.infer<typeof CustomerSettingsSchema>
export type CustomerSettingsPatch = z.infer<typeof CustomerSettingsPatchSchema>
