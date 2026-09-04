import { z } from 'zod'

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
  company: z.object({ id: z.number().int().positive(), name: z.string() }),
})
export type Me = z.infer<typeof MeSchema>
