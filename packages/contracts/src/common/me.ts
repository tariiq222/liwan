import { z } from 'zod'
import { CapabilitySchema, MeRoleSchema } from '../access'

export const RoleSchema = z.enum(['employee', 'admin', 'vendor'])
export type Role = z.infer<typeof RoleSchema>

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
})
export type Me = z.infer<typeof MeSchema>
