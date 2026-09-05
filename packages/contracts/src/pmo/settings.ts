import { z } from 'zod'

export const ProjectCreatorsSchema = z.enum(['managers', 'employees'])
export const PROJECT_CREATORS = ProjectCreatorsSchema.options

export const DefaultStageSchema = z.object({ name: z.string().min(1), fold: z.boolean() }).strict()

export const ProjectSettingsSchema = z.object({ project_creators: ProjectCreatorsSchema, default_stages: z.array(DefaultStageSchema).min(1).max(20) }).strict()

export const ProjectSettingsPatchSchema = ProjectSettingsSchema.partial().strict()

export type ProjectSettings = z.infer<typeof ProjectSettingsSchema>
export type DefaultStage = z.infer<typeof DefaultStageSchema>
