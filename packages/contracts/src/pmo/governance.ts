import { z } from 'zod'

const GovernanceDateSchema = z.string().regex(/^(?!0000)\d{4}-\d{2}-\d{2}$/).refine(value => {
  const parsed = new Date(`${value}T00:00:00Z`)
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
}, 'A real calendar date is required')

export const GovernanceUserRefSchema = z.object({ id: z.number().int().positive(), name: z.string() }).strict()
export const GovernanceTaskRefSchema = z.object({ id: z.number().int().positive(), name: z.string() }).strict()
export const GovernanceStakeholderRefSchema = z.object({ id: z.number().int().positive(), name: z.string() }).strict()

export const ProjectStakeholderSchema = z.object({
  id: z.number().int().positive(),
  name: z.string(),
  user: GovernanceUserRefSchema.nullable(),
  organization: z.string(),
  role: z.string(),
  contact: z.string(),
  notes: z.string(),
}).strict()
export const ProjectStakeholderListSchema = z.object({
  items: z.array(ProjectStakeholderSchema), total: z.number().int().nonnegative(), can_manage: z.boolean(),
}).strict()
export const ProjectStakeholderWriteSchema = z.object({
  name: z.string().optional(), user_id: z.number().int().positive().nullable().optional(),
  organization: z.string().optional(), role: z.string().optional(), contact: z.string().optional(), notes: z.string().optional(),
}).strict()

export const ProjectRaciRoleSchema = z.enum(['R', 'A', 'C', 'I'])
export const ProjectRaciSchema = z.object({
  id: z.number().int().positive(), task: GovernanceTaskRefSchema, stakeholder: GovernanceStakeholderRefSchema, role: ProjectRaciRoleSchema,
}).strict()
export const ProjectRaciListSchema = z.object({
  items: z.array(ProjectRaciSchema), total: z.number().int().nonnegative(), can_manage: z.boolean(),
}).strict()
export const ProjectRaciWriteSchema = z.object({
  task_id: z.number().int().positive().optional(), stakeholder_id: z.number().int().positive().optional(), role: ProjectRaciRoleSchema.optional(),
}).strict()

export const ProjectRegisterKindSchema = z.enum(['risk', 'issue'])
export const ProjectRegisterPrioritySchema = z.enum(['low', 'normal', 'high', 'critical'])
export const ProjectRegisterStatusSchema = z.enum(['open', 'in_progress', 'resolved', 'closed'])
export const ProjectRegisterSchema = z.object({
  id: z.number().int().positive(), kind: ProjectRegisterKindSchema, title: z.string(), description: z.string(),
  priority: ProjectRegisterPrioritySchema, status: ProjectRegisterStatusSchema, owner: GovernanceUserRefSchema.nullable(),
  due_date: GovernanceDateSchema.nullable(), response: z.string(), task: GovernanceTaskRefSchema.nullable(),
  probability: z.number().int().min(1).max(5).nullable(), impact: z.number().int().min(1).max(5).nullable(),
  score: z.number().int().min(1).max(25).nullable(),
}).strict().superRefine((value, ctx) => {
  if (value.kind === 'issue' ? [value.probability, value.impact, value.score].some(metric => metric !== null) : value.probability === null || value.impact === null || value.score !== value.probability * value.impact) {
    ctx.addIssue({ code: 'custom', message: 'Metrics must match kind and score must equal probability times impact', path: ['score'] })
  }
})
export const ProjectRegisterListSchema = z.object({
  items: z.array(ProjectRegisterSchema), total: z.number().int().nonnegative(), can_manage: z.boolean(),
}).strict()
export const ProjectRegisterWriteSchema = z.object({
  kind: ProjectRegisterKindSchema.optional(), title: z.string().optional(), description: z.string().optional(),
  priority: ProjectRegisterPrioritySchema.optional(), status: ProjectRegisterStatusSchema.optional(),
  owner_id: z.number().int().positive().nullable().optional(), due_date: GovernanceDateSchema.nullable().optional(),
  response: z.string().optional(), task_id: z.number().int().positive().nullable().optional(),
  probability: z.number().int().min(1).max(5).optional(), impact: z.number().int().min(1).max(5).optional(),
}).strict().superRefine((value, ctx) => {
  if (value.kind === 'issue' && (value.probability !== undefined || value.impact !== undefined) || value.kind === 'risk' && (value.probability === undefined || value.impact === undefined)) {
    ctx.addIssue({ code: 'custom', message: 'Metrics must match the register kind', path: ['kind'] })
  }
})

export type GovernanceUserRef = z.infer<typeof GovernanceUserRefSchema>
export type ProjectStakeholder = z.infer<typeof ProjectStakeholderSchema>
export type ProjectStakeholderWrite = z.infer<typeof ProjectStakeholderWriteSchema>
export type ProjectRaciRole = z.infer<typeof ProjectRaciRoleSchema>
export type ProjectRaci = z.infer<typeof ProjectRaciSchema>
export type ProjectRaciWrite = z.infer<typeof ProjectRaciWriteSchema>
export type ProjectRegisterKind = z.infer<typeof ProjectRegisterKindSchema>
export type ProjectRegisterPriority = z.infer<typeof ProjectRegisterPrioritySchema>
export type ProjectRegisterStatus = z.infer<typeof ProjectRegisterStatusSchema>
export type ProjectRegister = z.infer<typeof ProjectRegisterSchema>
export type ProjectRegisterWrite = z.infer<typeof ProjectRegisterWriteSchema>
