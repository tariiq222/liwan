import { z } from 'zod'
import { CatalogRefSchema, CurrencyRefSchema } from './project-charter'

const ChangeUserRefSchema = z.object({ id: z.number().int().positive(), name: z.string() }).strict()

// draft -> submitted -> approved | rejected; withdrawn before a decision; implemented after approval.
export const ProjectChangeStateSchema = z.enum(['draft', 'submitted', 'approved', 'rejected', 'withdrawn', 'implemented'])
export const PROJECT_CHANGE_STATES = ProjectChangeStateSchema.options

// The company's change control: no requests, requests that block nothing, or requests the executing project needs.
export const ChangeControlModeSchema = z.enum(['off', 'optional', 'required'])
export const CHANGE_CONTROL_MODES = ChangeControlModeSchema.options

export const CHANGE_NOTE_MAX = 2000

export const ProjectChangeSchema = z.object({
  id: z.number().int().positive(),
  project_id: z.number().int().positive(),
  number: z.number().int().positive(),
  title: z.string(),
  description: z.string(),
  reason: z.string(),
  category: CatalogRefSchema.nullable(),
  state: ProjectChangeStateSchema,
  requester: ChangeUserRefSchema,
  impact_schedule_days: z.number().int(),
  impact_cost: z.number(),
  currency: CurrencyRefSchema.nullable(),
  impact_scope: z.string(),
  decided_by: ChangeUserRefSchema.nullable(),
  decided_at: z.string().nullable(),
  decision_note: z.string(),
  implemented_at: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string().regex(/^v\d+$/),
  can_edit: z.boolean(),
  can_submit: z.boolean(),
  can_withdraw: z.boolean(),
  can_decide: z.boolean(),
  can_implement: z.boolean(),
}).strict()

export const ProjectChangeListSchema = z.object({
  items: z.array(ProjectChangeSchema),
  total: z.number().int().nonnegative(),
  can_create: z.boolean(),
}).strict()

// Body of POST (create) and PATCH (a draft, with the token of the request being edited).
export const ProjectChangeWriteSchema = z.object({
  title: z.string().optional(),
  description: z.string().optional(),
  reason: z.string().optional(),
  category_id: z.number().int().positive().nullable().optional(),
  impact_schedule_days: z.number().int().optional(),
  impact_cost: z.number().optional(),
  impact_scope: z.string().optional(),
}).strict()
export const ProjectChangePatchSchema = ProjectChangeWriteSchema.extend({ expected_updated_at: z.string().regex(/^v\d+$/) }).strict()

// Bodies of the actions. The token is optional on every one; only the sponsor's decisions take a note: an approval may carry
// one, a rejection must. Submit, withdraw and implement take the token alone, as the server refuses any other key.
const WriteToken = z.string().regex(/^v\d+$/)
export const ProjectChangeTransitionSchema = z.object({ expected_updated_at: WriteToken.optional() }).strict()
export const ProjectChangeApproveSchema = z.object({ expected_updated_at: WriteToken.optional(), note: z.string().max(CHANGE_NOTE_MAX).optional() }).strict()
export const ProjectChangeRejectSchema = z.object({ expected_updated_at: WriteToken.optional(), note: z.string().trim().min(1).max(CHANGE_NOTE_MAX) }).strict()

export const ChangeCategorySchema = CatalogRefSchema.extend({ sequence: z.number().int(), active: z.boolean() }).strict()
export const ChangeCategoryListSchema = z.object({ items: z.array(ChangeCategorySchema), total: z.number().int().nonnegative() }).strict()
export const ChangeCategoryWriteSchema = z.object({ name: z.string().min(1).optional(), sequence: z.number().int().optional(), active: z.boolean().optional() }).strict()

export type ProjectChangeState = z.infer<typeof ProjectChangeStateSchema>
export type ChangeControlMode = z.infer<typeof ChangeControlModeSchema>
export type ProjectChange = z.infer<typeof ProjectChangeSchema>
export type ProjectChangeList = z.infer<typeof ProjectChangeListSchema>
export type ProjectChangeWrite = z.infer<typeof ProjectChangeWriteSchema>
export type ProjectChangeTransition = z.infer<typeof ProjectChangeTransitionSchema>
export type ProjectChangeApprove = z.infer<typeof ProjectChangeApproveSchema>
export type ProjectChangeReject = z.infer<typeof ProjectChangeRejectSchema>
export type ChangeCategory = z.infer<typeof ChangeCategorySchema>
export type ChangeCategoryList = z.infer<typeof ChangeCategoryListSchema>
export type ChangeCategoryWrite = z.infer<typeof ChangeCategoryWriteSchema>
