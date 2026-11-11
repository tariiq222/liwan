import { z } from 'zod'
import { TagSchema } from './task'

export const TagListSchema = z.object({
  items: z.array(TagSchema), total: z.number().int().nonnegative(),
}).strict()

export type TagList = z.infer<typeof TagListSchema>
