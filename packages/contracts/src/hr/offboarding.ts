import { z } from 'zod'
import { HrRefSchema } from './ref'

/**
 * The offboarding area (`/api/v1/hr/offboarding`): a departure registered through the
 * stock hr.departure.wizard plus the clearance checklist, which is an offboarding plan
 * run. The plan and run shapes are onboarding's, so they are re-exported here and never
 * duplicated.
 */
const isoDate = z.iso.date()
const requirePatchField = (value: object) => Object.keys(value).length > 0

export {
  HrActivityPlanCreateSchema,
  HrActivityPlanListSchema,
  HrActivityPlanPatchSchema,
  HrActivityPlanSchema,
  HrPlanRunCreateSchema,
  HrPlanRunDetailSchema,
  HrPlanRunListSchema,
  HrPlanRunSchema,
  HrPlanRunStepSchema,
  HrPlanStepDoneSchema,
  HrPlanStepInputSchema,
  HrPlanStepSchema,
} from './onboarding'

export const HrDepartureReasonListSchema = z.object({
  items: z.array(HrRefSchema),
  total: z.number().int().nonnegative(),
}).strict()

// The clearance of one departure: the offboarding plan run and its progress.
export const HrDepartureClearanceSchema = z.object({
  run_id: z.number().int().positive().nullable(),
  done: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
}).strict()

export const HrDepartureSchema = z.object({
  employee: HrRefSchema,
  active: z.boolean(),
  departure_date: isoDate,
  reason: HrRefSchema.nullable(),
  description: z.string(),
  clearance: HrDepartureClearanceSchema,
}).strict()

export const HrDepartureListSchema = z.object({
  items: z.array(HrDepartureSchema),
  total: z.number().int().nonnegative(),
}).strict()

export const HrDepartureCreateSchema = z.object({
  employee_id: z.number().int().positive(),
  departure_date: isoDate,
  departure_reason_id: z.number().int().positive(),
  description: z.string().optional(),
  set_contract_end: z.boolean().optional(),
  plan_id: z.number().int().positive().nullable().optional(),
}).strict()

export const HrDeparturePatchSchema = z.object({
  departure_date: isoDate.optional(),
  departure_reason_id: z.number().int().positive().optional(),
  description: z.string().optional(),
}).strict().refine(requirePatchField, { message: 'At least one field is required' })

export type HrDepartureReasonList = z.infer<typeof HrDepartureReasonListSchema>
export type HrDepartureClearance = z.infer<typeof HrDepartureClearanceSchema>
export type HrDeparture = z.infer<typeof HrDepartureSchema>
export type HrDepartureList = z.infer<typeof HrDepartureListSchema>
export type HrDepartureCreate = z.infer<typeof HrDepartureCreateSchema>
export type HrDeparturePatch = z.infer<typeof HrDeparturePatchSchema>
