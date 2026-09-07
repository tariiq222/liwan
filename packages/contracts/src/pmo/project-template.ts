import { z } from 'zod'
import { ProjectDetailSchema } from './project'

const TemplateKeySchema = z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{0,63}$/)
const IsoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const parsed = new Date(`${value}T00:00:00Z`)
  return value.slice(0, 4) !== '0000' && !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value
}, 'must be a valid calendar date')

export const ProjectTemplateStageSchema = z.object({
  key: TemplateKeySchema,
  name: z.string().trim().min(1).max(255),
  fold: z.boolean(),
}).strict()

export const ProjectTemplateMilestoneSchema = z.object({
  key: TemplateKeySchema,
  name: z.string().trim().min(1).max(255),
  offset_days: z.number().int().min(-3650).max(3650),
}).strict()

export const ProjectTemplateTaskSchema = z.object({
  key: TemplateKeySchema,
  name: z.string().trim().min(1).max(255),
  stage_key: TemplateKeySchema,
  start_offset: z.number().int().min(-3650).max(3650),
  duration_days: z.number().int().min(1).max(3650),
  milestone_key: TemplateKeySchema.nullable(),
  dependency_keys: z.array(TemplateKeySchema),
}).strict()

const ProjectTemplateDefinitionShape = z.object({
  stages: z.array(ProjectTemplateStageSchema).min(1).max(100),
  milestones: z.array(ProjectTemplateMilestoneSchema).max(100),
  tasks: z.array(ProjectTemplateTaskSchema).max(100),
}).strict()

export const ProjectTemplateDefinitionSchema = ProjectTemplateDefinitionShape.superRefine((value, ctx) => {
  const stages = new Set<string>()
  for (const stage of value.stages) {
    if (stages.has(stage.key)) ctx.addIssue({ code: 'custom', message: 'duplicateReference', path: ['stages'] })
    stages.add(stage.key)
  }
  const milestones = new Set<string>()
  for (const milestone of value.milestones) {
    if (milestones.has(milestone.key)) ctx.addIssue({ code: 'custom', message: 'duplicateReference', path: ['milestones'] })
    milestones.add(milestone.key)
  }
  const tasks = new Map<string, typeof value.tasks[number]>()
  for (const task of value.tasks) {
    if (tasks.has(task.key)) ctx.addIssue({ code: 'custom', message: 'duplicateReference', path: ['tasks'] })
    tasks.set(task.key, task)
    if (!stages.has(task.stage_key)) ctx.addIssue({ code: 'custom', message: 'missingStage', path: ['tasks'] })
    if (task.milestone_key !== null && !milestones.has(task.milestone_key)) ctx.addIssue({ code: 'custom', message: 'missingMilestone', path: ['tasks'] })
  }
  for (const task of value.tasks) {
    if (new Set(task.dependency_keys).size !== task.dependency_keys.length) ctx.addIssue({ code: 'custom', message: 'duplicateReference', path: ['tasks'] })
    for (const dependency of task.dependency_keys) {
      if (!tasks.has(dependency)) ctx.addIssue({ code: 'custom', message: 'missingDependency', path: ['tasks'] })
    }
  }
  const visiting = new Set<string>()
  const visited = new Set<string>()
  const visit = (key: string) => {
    if (visiting.has(key)) { ctx.addIssue({ code: 'custom', message: 'dependencyCycle', path: ['tasks'] }); return }
    if (visited.has(key)) return
    visiting.add(key)
    for (const dependency of tasks.get(key)?.dependency_keys ?? []) if (tasks.has(dependency)) visit(dependency)
    visiting.delete(key); visited.add(key)
  }
  for (const key of tasks.keys()) visit(key)
})

export const ProjectTemplateSchema = z.object({
  id: z.number().int().positive(),
  name: z.string(),
  description: z.string(),
  definition: ProjectTemplateDefinitionSchema,
  can_manage: z.boolean(),
  can_apply: z.boolean(),
}).strict()

export const ProjectTemplateListSchema = z.object({
  items: z.array(ProjectTemplateSchema),
  total: z.number().int().nonnegative(),
  can_manage: z.boolean(),
  can_apply: z.boolean(),
}).strict()

export const ProjectTemplateCreateSchema = z.object({
  name: z.string().trim().min(1).max(255),
  description: z.string().optional(),
  definition: ProjectTemplateDefinitionSchema,
}).strict()

export const ProjectTemplatePatchSchema = ProjectTemplateCreateSchema.partial().strict().refine(value => Object.keys(value).length > 0, 'emptyPatch')

export const ProjectTemplateApplySchema = z.object({
  name: z.string().trim().min(1).max(255),
  start_date: IsoDateSchema,
}).strict()

export const ProjectTemplateApplyResponseSchema = ProjectDetailSchema

export type ProjectTemplateStage = z.infer<typeof ProjectTemplateStageSchema>
export type ProjectTemplateMilestone = z.infer<typeof ProjectTemplateMilestoneSchema>
export type ProjectTemplateTask = z.infer<typeof ProjectTemplateTaskSchema>
export type ProjectTemplateDefinition = z.infer<typeof ProjectTemplateDefinitionSchema>
export type ProjectTemplate = z.infer<typeof ProjectTemplateSchema>
export type ProjectTemplateList = z.infer<typeof ProjectTemplateListSchema>
export type ProjectTemplateCreate = z.infer<typeof ProjectTemplateCreateSchema>
export type ProjectTemplatePatch = z.infer<typeof ProjectTemplatePatchSchema>
export type ProjectTemplateApply = z.infer<typeof ProjectTemplateApplySchema>
