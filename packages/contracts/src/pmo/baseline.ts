import { z } from 'zod'
import { CurrencyRefSchema } from './project-charter'
import { CalendarDateSchema } from './schedule'

// What the planning -> executing gate asks of baselines: nothing, a warning the manager acknowledges, or a baseline.
export const BaselineGateSchema = z.enum(['off', 'warning', 'required'])
export const BASELINE_GATES = BaselineGateSchema.options

export const BASELINE_NOTE_MAX = 2000

const BaselineUserRefSchema = z.object({ id: z.number().int().positive(), name: z.string() }).strict()

export const ProjectBaselineSchema = z.object({
  id: z.number().int().positive(),
  project_id: z.number().int().positive(),
  number: z.number().int().positive(),
  taken_by: BaselineUserRefSchema,
  taken_at: z.string(),
  note: z.string(),
  change: z.object({ id: z.number().int().positive(), number: z.number().int().positive(), title: z.string() }).strict().nullable(),
  budget_total: z.number(),
  currency: CurrencyRefSchema.nullable(),
  planned_start: CalendarDateSchema.nullable(),
  planned_end: CalendarDateSchema.nullable(),
  task_count: z.number().int().nonnegative(),
}).strict()

export const ProjectBaselineTaskSchema = z.object({
  id: z.number().int().positive(),
  task_id: z.number().int().positive().nullable(),
  name: z.string(),
  planned_start: CalendarDateSchema.nullable(),
  planned_end: CalendarDateSchema.nullable(),
  planned_value_share: z.number().min(0).max(1),
}).strict()

export const ProjectBaselineDetailSchema = ProjectBaselineSchema.extend({ tasks: z.array(ProjectBaselineTaskSchema) }).strict()

const CoverableChangeSchema = z.object({ id: z.number().int().positive(), number: z.number().int().positive(), title: z.string() }).strict()

export const ProjectBaselineListSchema = z.object({
  items: z.array(ProjectBaselineSchema),
  total: z.number().int().nonnegative(),
  can_take: z.boolean(),
  change_required: z.boolean(),
  coverable_changes: z.array(CoverableChangeSchema),
}).strict()

// Body of POST: the plan itself is read on the server; the manager adds a note and, where change control asks, the covering request.
export const ProjectBaselineWriteSchema = z.object({
  note: z.string().max(BASELINE_NOTE_MAX).optional(),
  change_id: z.number().int().positive().optional(),
}).strict()

// Days after the baseline date (positive: late, negative: early); null where either date is missing.
const ScheduleRowSchema = z.object({
  baseline_start: CalendarDateSchema.nullable(),
  baseline_end: CalendarDateSchema.nullable(),
  current_start: CalendarDateSchema.nullable(),
  current_end: CalendarDateSchema.nullable(),
  start_variance_days: z.number().int().nullable(),
  end_variance_days: z.number().int().nullable(),
}).strict()

export const BaselineTaskVarianceSchema = ScheduleRowSchema.extend({
  task_id: z.number().int().positive().nullable(),
  name: z.string(),
  removed: z.boolean(),
}).strict()

export const BaselineVarianceSchema = z.object({
  project_id: z.number().int().positive(),
  baseline: z.object({ number: z.number().int().positive(), taken_at: z.string() }).strict().nullable(),
  schedule: z.object({
    project: ScheduleRowSchema,
    tasks: z.array(BaselineTaskVarianceSchema),
    late_count: z.number().int().nonnegative(),
    early_count: z.number().int().nonnegative(),
    undated_count: z.number().int().nonnegative(),
  }).strict().nullable(),
  cost: z.object({
    currency: CurrencyRefSchema.nullable(),
    baseline_budget: z.number(),
    current_budget: z.number(),
    budget_variance: z.number(),
    actual: z.number(),
    remaining_against_baseline: z.number(),
    over_baseline: z.boolean(),
  }).strict().nullable(),
}).strict()

export type BaselineGate = z.infer<typeof BaselineGateSchema>
export type ProjectBaseline = z.infer<typeof ProjectBaselineSchema>
export type ProjectBaselineTask = z.infer<typeof ProjectBaselineTaskSchema>
export type ProjectBaselineDetail = z.infer<typeof ProjectBaselineDetailSchema>
export type ProjectBaselineList = z.infer<typeof ProjectBaselineListSchema>
export type ProjectBaselineWrite = z.infer<typeof ProjectBaselineWriteSchema>
export type BaselineTaskVariance = z.infer<typeof BaselineTaskVarianceSchema>
export type BaselineVariance = z.infer<typeof BaselineVarianceSchema>
