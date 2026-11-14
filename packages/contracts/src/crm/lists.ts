import { z } from 'zod'

const NAME_MAX = 200

const NameSchema = z.string().trim().min(1).max(NAME_MAX)

export const CrmOutcomeEffectSchema = z.enum(['follow_up', 'won', 'lost', 'none'])

export const CrmStageSchema = z.strictObject({
  id: z.number().int(),
  name: z.string(),
  sequence: z.number().int(),
  is_won: z.boolean(),
  active: z.boolean(),
})

export const CrmOutcomeSchema = z.strictObject({
  id: z.number().int(),
  name: z.string(),
  effect: CrmOutcomeEffectSchema,
  lost_reason_id: z.number().int().nullable(),
  active: z.boolean(),
})

export const CrmLostReasonSchema = z.strictObject({
  id: z.number().int(),
  name: z.string(),
  active: z.boolean(),
  protected: z.boolean(),
})

export const CrmSourceSchema = z.strictObject({
  id: z.number().int(),
  name: z.string(),
  active: z.boolean(),
})

// A package is a service product (`product.template` id) the company offers; `price` is its unit price as typed on the
// product, `active` false while the product is archived.
export const CrmPackageSchema = z.strictObject({
  id: z.number().int(),
  name: z.string(),
  price: z.number().min(0),
  description: z.string(),
  active: z.boolean(),
})

const listOf = <T extends z.ZodTypeAny>(item: T) =>
  z.strictObject({ items: z.array(item), total: z.number().int().min(0) })

export const CrmStageListSchema = listOf(CrmStageSchema)
export const CrmOutcomeListSchema = listOf(CrmOutcomeSchema)
export const CrmLostReasonListSchema = listOf(CrmLostReasonSchema)
export const CrmSourceListSchema = listOf(CrmSourceSchema)
export const CrmPackageListSchema = listOf(CrmPackageSchema)

export const CrmStagePatchSchema = z
  .strictObject({ name: NameSchema, is_won: z.boolean(), active: z.boolean() })
  .partial()
  .refine((body) => Object.keys(body).length > 0, 'nothing to change')

export const CrmOutcomeCreateSchema = z.strictObject({
  name: NameSchema,
  effect: CrmOutcomeEffectSchema,
  lost_reason_id: z.number().int().positive().nullable().optional(),
})

// POST /api/v1/crm/packages adds an existing product (an id of GET /api/v1/products/pick) to the company's packages.
export const CrmPackageAddSchema = z.strictObject({
  product_id: z.number().int().positive(),
})

export type CrmStage = z.infer<typeof CrmStageSchema>
export type CrmOutcome = z.infer<typeof CrmOutcomeSchema>
export type CrmLostReason = z.infer<typeof CrmLostReasonSchema>
export type CrmSource = z.infer<typeof CrmSourceSchema>
export type CrmPackage = z.infer<typeof CrmPackageSchema>
