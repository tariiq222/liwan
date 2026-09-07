import { z } from 'zod'

export const PersonalStageSchema = z.object({ id: z.number().int().positive(), name: z.string(), sequence: z.number().int(), fold: z.boolean() }).strict()
export type PersonalStage = z.infer<typeof PersonalStageSchema>

export const PersonRefSchema = z.object({ id: z.number().int(), name: z.string(), user_id: z.number().int() }).strict()
