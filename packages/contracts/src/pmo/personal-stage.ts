import { z } from 'zod'

export const PersonalStageSchema = z.object({ id: z.number().int().positive(), name: z.string(), sequence: z.number().int(), fold: z.boolean() }).strict()

export const PersonalStageListSchema = z.object({
  items: z.array(PersonalStageSchema), total: z.number().int().nonnegative(),
}).strict()

export type PersonalStage = z.infer<typeof PersonalStageSchema>
export type PersonalStageList = z.infer<typeof PersonalStageListSchema>
