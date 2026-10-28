import { z } from 'zod'

import { CrmOpportunitySchema } from './opportunity'

const NOTE_MAX = 2000
const DURATION_MAX_MINUTES = 1440
const PRICE_MAX = 999_999_999

const RefSchema = z.strictObject({ id: z.number().int(), name: z.string() })
const IsoDateTimeSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/)

export const CrmCallSchema = z.strictObject({
  id: z.number().int(),
  outcome: RefSchema.nullable(),
  note: z.string(),
  duration_minutes: z.number().min(0),
  user: RefSchema.nullable(),
  created_at: IsoDateTimeSchema,
})

export const CrmCallListSchema = z.strictObject({
  items: z.array(CrmCallSchema),
  total: z.number().int().min(0),
})

// What a sale needs, in the call that records a sold outcome and in the sale action alone.
const saleShape = {
  package_id: z.number().int().positive(),
  final_price: z.number().min(0).max(PRICE_MAX),
  discount_percent: z.number().min(0).max(100).nullable().optional(),
}

export const CrmSaleSchema = z.strictObject(saleShape)

// Any sale field needs the package and the price: the sale is sent whole, and only with a sold outcome.
export const CrmCallCreateSchema = z
  .strictObject({
    outcome_id: z.number().int().positive(),
    note: z.string().max(NOTE_MAX).nullable().optional(),
    duration_minutes: z.number().min(0).max(DURATION_MAX_MINUTES).nullable().optional(),
    package_id: saleShape.package_id.optional(),
    final_price: saleShape.final_price.optional(),
    discount_percent: saleShape.discount_percent,
  })
  .refine(
    (body) =>
      [body.package_id, body.final_price, body.discount_percent].every((field) => field === undefined) ||
      (body.package_id !== undefined && body.final_price !== undefined),
    'a sale needs package_id and final_price',
  )

export const CrmCallResultSchema = z.strictObject({
  call: CrmCallSchema,
  opportunity: CrmOpportunitySchema,
})

export const CrmLostSchema = z.strictObject({ lost_reason_id: z.number().int().positive() })

export const CrmAssignSchema = z.strictObject({ user_id: z.number().int().positive() })
