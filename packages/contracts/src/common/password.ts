import { z } from 'zod'

export const MIN_PASSWORD_LENGTH = 8

export const PasswordChangeSchema = z.object({
  current: z.string().min(1),
  new: z.string().trim().min(MIN_PASSWORD_LENGTH),
}).strict()

export type PasswordChange = z.infer<typeof PasswordChangeSchema>
