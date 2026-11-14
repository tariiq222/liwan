import { z } from 'zod'
import {
  CustomFieldDefinitionPatchItemSchema,
  CustomFieldDefinitionSchema,
  CustomFieldLimitsSchema,
  CustomFieldValuesSchema,
  CustomFieldWithValueSchema,
} from '../common/customFields'

// liwan_customers: the commercial party (customer or vendor) on res.partner, owned by one shared service.
// Field for field with odoo-addons/liwan_customers/serializers/{customer,settings}.py.

const RefSchema = z.object({ id: z.number().int().positive(), name: z.string() }).strict()

export const CustomerSharingSchema = z.enum(['establishment', 'branch'])

/** Which customers the tenant serves: it decides the forms a new customer gets, never an existing one. */
export const CustomerPartyKindsSchema = z.enum(['individuals', 'companies', 'both'])

/**
 * A customer on the wire. `company` is null for a customer shared by every branch. Phones are E.164. `erased` is true
 * once the customer's personal data was erased: `name` is then a stored language-neutral marker, so a screen shows its
 * own translated name instead.
 */
export const CustomerSchema = z.object({
  id: z.number().int().positive(),
  name: z.string().min(1),
  erased: z.boolean(),
  phone: z.string().regex(/^\+[1-9]\d{6,14}$/).nullable(),
  email: z.string().nullable(),
  is_company: z.boolean(),
  parent: RefSchema.nullable(),
  active: z.boolean(),
  company: RefSchema.nullable(),
  // The tenant's customer fields, in its order, each with this customer's value.
  properties: z.array(CustomFieldWithValueSchema),
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
  // Only the customer fields this write sets, keyed by the tenant definition's keys; null clears one.
  properties: CustomFieldValuesSchema.optional(),
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

/** A country the tenant may read phone numbers in, named in the session's language. */
export const CustomerCountrySchema = z.object({
  id: z.number().int().positive(),
  code: z.string().length(2),
  name: z.string(),
}).strict()

export const CustomerCountryListSchema = z.object({
  items: z.array(CustomerCountrySchema),
  total: z.number().int().nonnegative(),
}).strict()

export const CustomerSettingsSchema = z.object({
  sharing: CustomerSharingSchema,
  party_kinds: CustomerPartyKindsSchema,
  phone_country: CustomerCountrySchema.nullable(),
  // The tenant's customer fields, in display order; every customer carries their values.
  fields: z.array(CustomFieldDefinitionSchema),
  field_limits: CustomFieldLimitsSchema,
  // Whether this session may change the settings: the capability in the working company and in the root company.
  can_manage: z.boolean(),
  revision: z.number().int().positive(),
}).strict()

export const CustomerSettingsPatchSchema = z.object({
  sharing: CustomerSharingSchema.optional(),
  party_kinds: CustomerPartyKindsSchema.optional(),
  phone_country_id: z.number().int().positive().nullable().optional(),
  // The whole definition in display order; a field left out is removed.
  fields: z.array(CustomFieldDefinitionPatchItemSchema).optional(),
  // Repeats a write that answered 409 `custom_field_values_exist` (removed fields or options), after the user saw the counts.
  confirm_field_removal: z.literal(true).optional(),
  revision: z.number().int().positive(),
}).strict().refine(
  (patch) => Object.keys(patch).some((key) => key !== 'revision' && key !== 'confirm_field_removal'),
  { message: 'nothing to change' },
)

/**
 * `details` of the 409 `custom_field_values_exist`: what a settings write would take from customers. `fields` are the
 * removed fields that still have values; `options` are the options removed from a field that stays and that customers
 * still hold. Each carries the number of customers that lose a value, and at least one of the two lists has an entry.
 */
export const CustomerFieldRemovalDetailsSchema = z.object({
  fields: z.array(z.object({
    key: z.string().min(1),
    label: z.string().min(1),
    count: z.number().int().positive(),
  }).strict()),
  options: z.array(z.object({
    field_key: z.string().min(1),
    field_label: z.string().min(1),
    key: z.string().min(1),
    label: z.string().min(1),
    count: z.number().int().positive(),
  }).strict()),
}).strict().refine((details) => details.fields.length + details.options.length > 0, { message: 'nothing is removed' })

export type CustomerSharing = z.infer<typeof CustomerSharingSchema>
export type CustomerPartyKinds = z.infer<typeof CustomerPartyKindsSchema>
export type Customer = z.infer<typeof CustomerSchema>
export type CustomerList = z.infer<typeof CustomerListSchema>
export type CustomerCandidate = z.infer<typeof CustomerCandidateSchema>
export type CustomerCandidateList = z.infer<typeof CustomerCandidateListSchema>
export type CustomerConflictDetails = z.infer<typeof CustomerConflictDetailsSchema>
export type CustomerCreate = z.infer<typeof CustomerCreateSchema>
export type CustomerPatch = z.infer<typeof CustomerPatchSchema>
export type CustomerCountry = z.infer<typeof CustomerCountrySchema>
export type CustomerCountryList = z.infer<typeof CustomerCountryListSchema>
export type CustomerSettings = z.infer<typeof CustomerSettingsSchema>
export type CustomerSettingsPatch = z.infer<typeof CustomerSettingsPatchSchema>
export type CustomerFieldRemovalDetails = z.infer<typeof CustomerFieldRemovalDetailsSchema>
export * from './privacy'
