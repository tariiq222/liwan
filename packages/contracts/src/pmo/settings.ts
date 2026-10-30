import { z } from 'zod'

export const ProjectCreatorsSchema = z.enum(['managers', 'employees'])
export const PROJECT_CREATORS = ProjectCreatorsSchema.options

export const DefaultCompletionApprovalSchema = z.enum(['none', 'project_manager'])

// Closing a project that still has open tasks: refuse it, or allow it once the manager confirms the warning.
export const CloseWithOpenTasksSchema = z.enum(['block', 'allow_with_warning'])
// Risk and issue status changes: one neighbouring step at a time, or any status.
export const RegisterStatusTransitionsSchema = z.enum(['sequence', 'free'])

export const DefaultStageSchema = z.object({ name: z.string().min(1), fold: z.boolean() }).strict()

/**
 * A company setting an installed application adds to the project settings: labelled by the server in the user's
 * language and written back under its `name`. A `selection` carries its `options`.
 */
const extensionBase = { name: z.string().min(1), label: z.string().min(1), help: z.string().nullable() }
export const ProjectSettingsExtensionSchema = z.discriminatedUnion('kind', [
  z.object({
    ...extensionBase,
    kind: z.literal('selection'),
    value: z.string().nullable(),
    options: z.array(z.object({ value: z.string(), label: z.string() }).strict()),
  }).strict(),
  z.object({ ...extensionBase, kind: z.literal('boolean'), value: z.boolean() }).strict(),
])

export const ProjectSettingsSchema = z.object({
  project_creators: ProjectCreatorsSchema,
  default_stages: z.array(DefaultStageSchema).min(1).max(20),
  require_manager_on_create: z.boolean(),
  require_end_date_on_create: z.boolean(),
  default_completion_approval: DefaultCompletionApprovalSchema,
  deadline_reminders_enabled: z.boolean(),
  deadline_reminders_days_before: z.number().int().min(0).max(30),
  overdue_digest_enabled: z.boolean(),
  require_charter_approval: z.boolean(),
  close_with_open_tasks: CloseWithOpenTasksSchema,
  register_status_transitions: RegisterStatusTransitionsSchema,
  extensions: z.array(ProjectSettingsExtensionSchema),
}).strict()

/**
 * PATCH /settings/projects: the generic fields only (`extensions` is read-only here). The server also accepts each
 * extension field flat by its name, so `ProjectSettingsPatch` adds a string-boolean-or-null entry per extension name.
 */
export const ProjectSettingsPatchSchema = ProjectSettingsSchema.omit({ extensions: true }).partial().strict()

export const ProjectCreateDefaultsSchema = z.object({
  require_manager_on_create: z.boolean(),
  require_end_date_on_create: z.boolean(),
  default_manager_id: z.number().int().positive(),
}).strict()

export type ProjectSettings = z.infer<typeof ProjectSettingsSchema>
export type ProjectSettingsExtension = z.infer<typeof ProjectSettingsExtensionSchema>
export type ProjectSettingsPatch = Partial<Omit<ProjectSettings, 'extensions'>> & { [extensionName: string]: unknown }
export type DefaultStage = z.infer<typeof DefaultStageSchema>
export type ProjectCreateDefaults = z.infer<typeof ProjectCreateDefaultsSchema>
