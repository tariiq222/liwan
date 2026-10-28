import { z } from 'zod'

const NAME_MAX = 200
// The server's PRICE_MAX (webvue_crm serializers/lists.py).
const PRICE_MAX = 999_999_999

const NameSchema = z.string().trim().min(1).max(NAME_MAX)
const PriceSchema = z.number().min(0).max(PRICE_MAX)

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

export const CrmPackageSchema = z.strictObject({
  id: z.number().int(),
  name: z.string(),
  price: PriceSchema,
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

export const CrmStageCreateSchema = z.strictObject({ name: NameSchema, is_won: z.boolean().optional() })
export const CrmStagePatchSchema = z
  .strictObject({ name: NameSchema, is_won: z.boolean(), active: z.boolean() })
  .partial()
  .refine((body) => Object.keys(body).length > 0, 'nothing to change')
export const CrmStageOrderSchema = z.strictObject({ ids: z.array(z.number().int()) })

export const CrmOutcomeCreateSchema = z.strictObject({
  name: NameSchema,
  effect: CrmOutcomeEffectSchema,
  lost_reason_id: z.number().int().positive().nullable().optional(),
})
export const CrmOutcomePatchSchema = z
  .strictObject({
    name: NameSchema,
    effect: CrmOutcomeEffectSchema,
    lost_reason_id: z.number().int().positive().nullable(),
    active: z.boolean(),
  })
  .partial()
  .refine((body) => Object.keys(body).length > 0, 'nothing to change')

// Lost reasons and sources share the same write body: a name, plus `active` on patch.
export const CrmNamedCreateSchema = z.strictObject({ name: NameSchema })
export const CrmNamedPatchSchema = z
  .strictObject({ name: NameSchema, active: z.boolean() })
  .partial()
  .refine((body) => Object.keys(body).length > 0, 'nothing to change')

export const CrmPackageCreateSchema = z.strictObject({
  name: NameSchema,
  price: PriceSchema,
  description: z.string().max(2000).optional(),
})
export const CrmPackagePatchSchema = z
  .strictObject({ name: NameSchema, price: PriceSchema, description: z.string().max(2000), active: z.boolean() })
  .partial()
  .refine((body) => Object.keys(body).length > 0, 'nothing to change')

export type CrmStage = z.infer<typeof CrmStageSchema>
export type CrmOutcome = z.infer<typeof CrmOutcomeSchema>
export type CrmLostReason = z.infer<typeof CrmLostReasonSchema>
export type CrmSource = z.infer<typeof CrmSourceSchema>
export type CrmPackage = z.infer<typeof CrmPackageSchema>
