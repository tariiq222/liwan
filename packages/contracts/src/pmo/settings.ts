import { z } from 'zod'

export const ProjectCreatorsSchema = z.enum(['managers', 'employees'])
export const PROJECT_CREATORS = ProjectCreatorsSchema.options

export const DefaultCompletionApprovalSchema = z.enum(['none', 'project_manager'])

export const DefaultStageSchema = z.object({ name: z.string().min(1), fold: z.boolean() }).strict()

export const ProjectSettingsSchema = z.object({
  project_creators: ProjectCreatorsSchema,
  default_stages: z.array(DefaultStageSchema).min(1).max(20),
  require_manager_on_create: z.boolean(),
  require_end_date_on_create: z.boolean(),
  default_completion_approval: DefaultCompletionApprovalSchema,
  deadline_reminders_enabled: z.boolean(),
  deadline_reminders_days_before: z.number().int().min(0).max(30),
  overdue_digest_enabled: z.boolean(),
}).strict()

export const ProjectSettingsPatchSchema = ProjectSettingsSchema.partial().strict()

export const ProjectCreateDefaultsSchema = z.object({
  require_manager_on_create: z.boolean(),
  require_end_date_on_create: z.boolean(),
  default_manager_id: z.number().int().positive(),
}).strict()

export type ProjectSettings = z.infer<typeof ProjectSettingsSchema>
export type DefaultStage = z.infer<typeof DefaultStageSchema>
export type ProjectCreateDefaults = z.infer<typeof ProjectCreateDefaultsSchema>
