import { z } from 'zod'

export const TagCreateSchema = z.object({ name: z.string().min(1) }).strict()
