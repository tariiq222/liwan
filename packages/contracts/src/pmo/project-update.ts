import { z } from 'zod'
import { ProjectStatusSchema, UserRefSchema } from './project'

export const ProjectUpdateSchema = z.object({
  id: z.number().int().positive(), name: z.string(), status: ProjectStatusSchema, description_html: z.string(),
  date: z.string(), author: UserRefSchema,
}).strict()

export const ProjectUpdateBodySchema = z.object({ status: ProjectStatusSchema, name: z.string().min(1), description: z.string().optional() }).strict()

export type ProjectUpdate = z.infer<typeof ProjectUpdateSchema>
export type ProjectUpdateBody = z.infer<typeof ProjectUpdateBodySchema>
