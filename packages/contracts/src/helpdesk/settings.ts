import { z } from 'zod'

const OptionSchema = z.object({ value: z.string(), label: z.string() }).strict()

export const HelpdeskSettingsSchema = z.object({
  revision: z.number().int().nonnegative(),
  preset: z.string(),
  visibility: z.enum(['own', 'team', 'all']),
  default_team_id: z.number().int().positive().nullable(),
  default_priority: z.enum(['0', '1', '2', '3']),
  reference_prefix: z.string(),
  reopen_days: z.number().int().nonnegative(),
  first_response_hours: z.number().int().nonnegative(),
  resolution_hours: z.number().int().nonnegative(),
  portal_enabled: z.boolean(),
  auto_close_days: z.number().int().nonnegative(),
  auto_close_stage_ids: z.array(z.number().int().positive()),
  options: z.object({
    presets: z.array(OptionSchema),
    visibility: z.array(OptionSchema),
    priorities: z.array(OptionSchema),
    priority_names: z.record(z.string(), z.string()),
    ranges: z.record(z.string(), z.array(z.number().int())),
  }).strict(),
}).strict()

/** The patch: the revision the screen read, then the changed settings only. A preset applies its bundle. */
export const HelpdeskSettingsPatchSchema = z.object({
  revision: z.number().int().nonnegative(),
  preset: z.string().optional(),
  visibility: z.enum(['own', 'team', 'all']).optional(),
  default_team_id: z.number().int().positive().nullable().optional(),
  default_priority: z.enum(['0', '1', '2', '3']).optional(),
  reference_prefix: z.string().min(1).max(10).optional(),
  reopen_days: z.number().int().min(0).max(90).optional(),
  first_response_hours: z.number().int().min(0).max(720).optional(),
  resolution_hours: z.number().int().min(0).max(8760).optional(),
  portal_enabled: z.boolean().optional(),
  auto_close_days: z.number().int().min(0).max(365).optional(),
  auto_close_stage_ids: z.array(z.number().int().positive()).optional(),
}).strict()

export type HelpdeskSettings = z.infer<typeof HelpdeskSettingsSchema>
export type HelpdeskSettingsPatch = z.infer<typeof HelpdeskSettingsPatchSchema>
