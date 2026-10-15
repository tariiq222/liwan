import { z } from 'zod'

const CharterUserRefSchema = z.object({
  id: z.number().int().positive(),
  name: z.string(),
}).strict()

export const CurrencyRefSchema = z.object({
  id: z.number().int().positive(),
  name: z.string(),
  symbol: z.string(),
  decimal_places: z.number().int(),
}).strict()

export const CatalogRefSchema = z.object({
  id: z.number().int().positive(),
  name: z.string(),
}).strict()

// Optional charter wizard steps, in walk order. The basics and review steps
// always exist and are not part of this list; a project type chooses which of
// these it includes.
export const ProjectCharterStepSchema = z.enum(['justification', 'scope', 'schedule', 'budget', 'risks'])
export const PROJECT_CHARTER_STEPS = ProjectCharterStepSchema.options
export const ProjectCharterStateSchema = z.enum(['draft', 'submitted', 'approved'])
export const PROJECT_CHARTER_STATES = ProjectCharterStateSchema.options

export const ProjectTypeRefSchema = CatalogRefSchema.extend({
  charter_steps: z.array(ProjectCharterStepSchema),
}).strict()

export const ProjectObjectiveSchema = z.object({
  goal: z.string(),
  metric: z.string(),
  target: z.string(),
}).strict()

export const ProjectDeliverableSchema = z.object({
  name: z.string(),
  description: z.string(),
  acceptance: z.string(),
}).strict()

export const BudgetStateSchema = z.enum(['unknown', 'estimate'])
export const ProjectPrioritySchema = z.enum(['low', 'normal', 'high', 'critical'])

export const ProjectCharterSchema = z.object({
  code: z.string().nullable(),
  type: ProjectTypeRefSchema.nullable(),
  owning_unit: CatalogRefSchema.nullable(),
  sponsor: CharterUserRefSchema.nullable(),
  authority: z.string(),
  rationale: z.string(),
  objectives: z.array(ProjectObjectiveSchema),
  benefits: z.string(),
  scope: z.string(),
  exclusions: z.string(),
  high_level_requirements: z.string(),
  deliverables: z.array(ProjectDeliverableSchema),
  success: z.string(),
  budget_state: BudgetStateSchema,
  amount: z.number().nullable(),
  currency: CurrencyRefSchema.nullable(),
  priority: ProjectPrioritySchema.nullable(),
  assumptions: z.string(),
  constraints: z.string(),
  closure: z.string(),
  state: ProjectCharterStateSchema,
  approval_required: z.boolean(),
  can_review: z.boolean(),
  submitted_by: CharterUserRefSchema.nullable(),
  submitted_at: z.string().nullable(),
  approved_by: CharterUserRefSchema.nullable(),
  approved_at: z.string().nullable(),
  return_note: z.string(),
}).strict()

export const ProjectCharterWriteSchema = z.object({
  type_id: z.number().int().positive().nullable().optional(),
  owning_unit_id: z.number().int().positive().nullable().optional(),
  sponsor_id: z.number().int().positive().nullable().optional(),
  authority: z.string().optional(),
  rationale: z.string().optional(),
  objectives: z.array(ProjectObjectiveSchema).optional(),
  benefits: z.string().optional(),
  scope: z.string().optional(),
  exclusions: z.string().optional(),
  high_level_requirements: z.string().optional(),
  deliverables: z.array(ProjectDeliverableSchema).optional(),
  success: z.string().optional(),
  budget_state: BudgetStateSchema.optional(),
  amount: z.number().nullable().optional(),
  priority: ProjectPrioritySchema.nullable().optional(),
  assumptions: z.string().optional(),
  constraints: z.string().optional(),
  closure: z.string().optional(),
}).strict()

export const CHARTER_RETURN_NOTE_MAX = 2000
export const ProjectCharterTransitionSchema = z.object({ expected_updated_at: z.string() }).strict()
export const ProjectCharterReturnSchema = ProjectCharterTransitionSchema.extend({
  note: z.string().trim().min(1).max(CHARTER_RETURN_NOTE_MAX),
}).strict()
export type ProjectCharterAction = 'submit' | 'approve' | 'return' | 'withdraw'

export const ProjectCharterDefaultsSchema = z.object({
  currency: CurrencyRefSchema.nullable(),
}).strict()

export type CurrencyRef = z.infer<typeof CurrencyRefSchema>
export type CatalogRef = z.infer<typeof CatalogRefSchema>
export type ProjectTypeRef = z.infer<typeof ProjectTypeRefSchema>
export type ProjectCharterStep = z.infer<typeof ProjectCharterStepSchema>
export type ProjectCharterState = z.infer<typeof ProjectCharterStateSchema>
export type ProjectObjective = z.infer<typeof ProjectObjectiveSchema>
export type ProjectDeliverable = z.infer<typeof ProjectDeliverableSchema>
export type BudgetState = z.infer<typeof BudgetStateSchema>
export type ProjectPriority = z.infer<typeof ProjectPrioritySchema>
export type ProjectCharter = z.infer<typeof ProjectCharterSchema>
export type ProjectCharterWrite = z.infer<typeof ProjectCharterWriteSchema>
export type ProjectCharterDefaults = z.infer<typeof ProjectCharterDefaultsSchema>
