import { z } from 'zod'
import { HrRefSchema } from './ref'

/**
 * The onboarding area (`/api/v1/hr/onboarding`), over stock mail activity plans. The
 * offboarding area runs the same plans and runs with its purpose fixed, so it re-exports
 * these shapes instead of copying them.
 */
const isoDate = z.iso.date()
const relationId = z.number().int().positive().nullable().optional()
const nonEmptyTrimmedName = z.string().trim().min(1)
const requirePatchField = (value: object) => Object.keys(value).length > 0

export const HrPlanResponsibleTypeSchema = z.enum(['manager', 'coach', 'employee', 'other'])
export const HrPlanDelayUnitSchema = z.enum(['days', 'weeks', 'months'])
export const HrPlanDelayFromSchema = z.enum(['before_plan_date', 'after_plan_date'])
export const HrPlanRunStateSchema = z.enum(['open', 'done'])
export const HrPlanRunStepStateSchema = z.enum(['planned', 'today', 'overdue', 'done'])

// A plan step: one activity template of a mail.activity.plan.
export const HrPlanStepSchema = z.object({
  id: z.number().int().positive(),
  summary: z.string(),
  responsible_type: HrPlanResponsibleTypeSchema,
  responsible: HrRefSchema.nullable(),
  delay_count: z.number().int().nonnegative(),
  delay_unit: HrPlanDelayUnitSchema,
  delay_from: HrPlanDelayFromSchema,
}).strict()

export const HrPlanStepInputSchema = z.object({
  summary: nonEmptyTrimmedName,
  responsible_type: HrPlanResponsibleTypeSchema,
  responsible_user_id: z.number().int().positive().nullable().optional(),
  delay_count: z.number().int().nonnegative(),
  delay_unit: HrPlanDelayUnitSchema,
  delay_from: HrPlanDelayFromSchema,
}).strict().superRefine((value, ctx) => {
  if (value.responsible_type === 'other' && !value.responsible_user_id) {
    ctx.addIssue({
      code: 'custom',
      path: ['responsible_user_id'],
      message: 'A responsible user is required for the other type.',
    })
  }
  if (value.responsible_type !== 'other' && value.responsible_user_id) {
    ctx.addIssue({
      code: 'custom',
      path: ['responsible_user_id'],
      message: 'Only the other type names a user.',
    })
  }
})

export const HrActivityPlanSchema = z.object({
  id: z.number().int().positive(),
  name: z.string(),
  department: HrRefSchema.nullable(),
  active: z.boolean(),
  steps: z.array(HrPlanStepSchema),
}).strict()

export const HrActivityPlanListSchema = z.object({
  items: z.array(HrActivityPlanSchema),
  total: z.number().int().nonnegative(),
}).strict()

export const HrActivityPlanCreateSchema = z.object({
  name: nonEmptyTrimmedName,
  department_id: relationId,
  steps: z.array(HrPlanStepInputSchema).min(1),
}).strict()

export const HrActivityPlanPatchSchema = z.object({
  name: nonEmptyTrimmedName.optional(),
  department_id: relationId,
  active: z.boolean().optional(),
  // The steps replace the plan's templates; an empty set is refused.
  steps: z.array(HrPlanStepInputSchema).min(1).optional(),
}).strict().refine(requirePatchField, { message: 'At least one field is required' })

// One launch of a plan on one employee: the run, without its checklist.
export const HrPlanRunSchema = z.object({
  id: z.number().int().positive(),
  employee: HrRefSchema,
  plan: HrRefSchema,
  plan_date: isoDate,
  launched_by: HrRefSchema,
  done: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
  state: HrPlanRunStateSchema,
}).strict()

export const HrPlanRunListSchema = z.object({
  items: z.array(HrPlanRunSchema),
  total: z.number().int().nonnegative(),
}).strict()

export const HrPlanRunStepSchema = z.object({
  id: z.number().int().positive(),
  summary: z.string(),
  assignee: HrRefSchema.nullable(),
  date_deadline: isoDate,
  state: HrPlanRunStepStateSchema,
  date_done: isoDate.nullable(),
  can_complete: z.boolean(),
}).strict()

export const HrPlanRunDetailSchema = HrPlanRunSchema.extend({
  steps: z.array(HrPlanRunStepSchema),
}).strict()

export const HrPlanRunCreateSchema = z.object({
  employee_id: z.number().int().positive(),
  plan_id: z.number().int().positive(),
  plan_date: isoDate.optional(),
}).strict()

export const HrPlanStepDoneSchema = z.object({
  feedback: z.string().optional(),
}).strict()

export type HrPlanResponsibleType = z.infer<typeof HrPlanResponsibleTypeSchema>
export type HrPlanDelayUnit = z.infer<typeof HrPlanDelayUnitSchema>
export type HrPlanDelayFrom = z.infer<typeof HrPlanDelayFromSchema>
export type HrPlanStep = z.infer<typeof HrPlanStepSchema>
export type HrPlanStepInput = z.infer<typeof HrPlanStepInputSchema>
export type HrActivityPlan = z.infer<typeof HrActivityPlanSchema>
export type HrActivityPlanList = z.infer<typeof HrActivityPlanListSchema>
export type HrActivityPlanCreate = z.infer<typeof HrActivityPlanCreateSchema>
export type HrActivityPlanPatch = z.infer<typeof HrActivityPlanPatchSchema>
export type HrPlanRun = z.infer<typeof HrPlanRunSchema>
export type HrPlanRunList = z.infer<typeof HrPlanRunListSchema>
export type HrPlanRunStep = z.infer<typeof HrPlanRunStepSchema>
export type HrPlanRunDetail = z.infer<typeof HrPlanRunDetailSchema>
export type HrPlanRunCreate = z.infer<typeof HrPlanRunCreateSchema>
export type HrPlanStepDone = z.infer<typeof HrPlanStepDoneSchema>
