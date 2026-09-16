import { z } from 'zod'
import { CapabilitySchema, MeRoleSchema } from '../access'

export const RoleSchema = z.enum(['employee', 'admin', 'vendor'])
export type Role = z.infer<typeof RoleSchema>

// Personal display preferences, stored per user on the server and applied
// from the header controls; a user only ever writes their own.
export const AppearanceModeSchema = z.enum(['light', 'cream', 'dark'])
export const FontSizeSchema = z.enum(['small', 'medium', 'large'])
export const MeAppearanceSchema = z.object({
  mode: AppearanceModeSchema,
  font_size: FontSizeSchema,
}).strict()
export const MeAppearancePatchSchema = z.object({
  mode: AppearanceModeSchema.optional(),
  font_size: FontSizeSchema.optional(),
}).strict().refine(value => value.mode !== undefined || value.font_size !== undefined, {
  message: 'mode or font_size is required',
})

export const MeSchema = z.object({
  id: z.number().int().positive(),
  name: z.string(),
  login: z.string(),
  email: z.string(),
  lang: z.string(),
  tz: z.string(),
  role: RoleSchema,
  roles: z.array(MeRoleSchema).optional().default([]),
  capabilities: z.array(CapabilitySchema).optional().default([]),
  access_policy_version: z.number().int().nonnegative().optional().default(0),
  company: z.object({ id: z.number().int().positive(), name: z.string() }),
  appearance: MeAppearanceSchema.optional(),
})
export type Me = z.infer<typeof MeSchema>
export type MeAppearance = z.infer<typeof MeAppearanceSchema>
export type MeAppearancePatch = z.infer<typeof MeAppearancePatchSchema>
