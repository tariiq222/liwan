import { z } from 'zod'
import { TagSchema } from './task'

export const TagCreateSchema = z.object({ name: z.string().min(1) }).strict()

export const TagListSchema = z.object({
  items: z.array(TagSchema), total: z.number().int().nonnegative(),
}).strict()

export type TagList = z.infer<typeof TagListSchema>
