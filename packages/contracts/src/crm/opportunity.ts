import { z } from 'zod'

const NAME_MAX = 200
const EMAIL_MAX = 254

const RefSchema = z.strictObject({ id: z.number().int(), name: z.string() })
const IsoDateTimeSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/)
const NameSchema = z.string().trim().min(1).max(NAME_MAX)
const EmailSchema = z.union([z.literal(''), z.string().trim().email().max(EMAIL_MAX)])

// The stable code of a refused write, in `details.reason` of the 422 on `phone` or `email`; the UI translates it.
export const CrmOpportunityWriteReasonSchema = z.enum(['invalid_phone', 'duplicate_phone', 'invalid_email'])

export const CrmOpportunityStatusSchema = z.enum(['pending', 'won', 'lost'])

export const CrmOpportunitySchema = z.strictObject({
  id: z.number().int(),
  contact_name: z.string(),
  phone: z.string(),
  email: z.string(),
  stage: RefSchema.nullable(),
  user: RefSchema.nullable(),
  source: RefSchema.nullable(),
  package: RefSchema.nullable(),
  lost_reason: RefSchema.nullable(),
  status: CrmOpportunityStatusSchema,
  list_price: z.number().min(0),
  discount_percent: z.number().min(0).max(100),
  final_price: z.number().min(0),
  expected_revenue: z.number().min(0),
  attempt_count: z.number().int().min(0),
  next_call_at: IsoDateTimeSchema.nullable(),
  cycle: z.number().int().min(0),
  recycle_at: IsoDateTimeSchema.nullable(),
  needs_manager: z.boolean(),
  active: z.boolean(),
  created_at: IsoDateTimeSchema,
})

export const CrmOpportunityListSchema = z.strictObject({
  items: z.array(CrmOpportunitySchema),
  total: z.number().int().min(0),
})

// `user_id` absent: the creator takes it; an id or null (the pool) needs crm.leads.assign.
export const CrmOpportunityCreateSchema = z.strictObject({
  contact_name: NameSchema,
  phone: NameSchema,
  email: EmailSchema.nullable().optional(),
  source_id: z.number().int().positive().nullable().optional(),
  user_id: z.number().int().positive().nullable().optional(),
})

export const CrmOpportunityPatchSchema = z
  .strictObject({
    contact_name: NameSchema,
    phone: NameSchema,
    email: EmailSchema.nullable(),
    source_id: z.number().int().positive().nullable(),
    stage_id: z.number().int().positive(),
  })
  .partial()
  .refine((body) => Object.keys(body).length > 0, 'nothing to change')

export const CrmOpportunityFiltersSchema = z.strictObject({
  stage_id: z.number().int().positive().optional(),
  user_id: z.number().int().positive().optional(),
  source_id: z.number().int().positive().optional(),
  due: z.boolean().optional(),
  unassigned: z.boolean().optional(),
  needs_manager: z.boolean().optional(),
  q: z.string().max(NAME_MAX).optional(),
})

export const CrmViewLogSchema = z.strictObject({
  id: z.number().int(),
  user: RefSchema,
  opportunity_id: z.number().int(),
  viewed_at: IsoDateTimeSchema,
})

export const CrmViewLogListSchema = z.strictObject({
  items: z.array(CrmViewLogSchema),
  total: z.number().int().min(0),
})

export type CrmOpportunityWriteReason = z.infer<typeof CrmOpportunityWriteReasonSchema>
export type CrmOpportunity = z.infer<typeof CrmOpportunitySchema>
export type CrmOpportunityList = z.infer<typeof CrmOpportunityListSchema>
export type CrmOpportunityCreate = z.infer<typeof CrmOpportunityCreateSchema>
export type CrmOpportunityPatch = z.infer<typeof CrmOpportunityPatchSchema>
export type CrmOpportunityFilters = z.infer<typeof CrmOpportunityFiltersSchema>
export type CrmViewLog = z.infer<typeof CrmViewLogSchema>
