import { z } from 'zod'

export const signupAppSchema = z.enum(['crm', 'inbox'])
export const signupAppsSchema = z.array(signupAppSchema).min(1).max(2)
  .refine(apps => new Set(apps).size === apps.length)
export const signupOfferSchema = z.strictObject({
  offer_revision: z.uuid(),
  trial_days: z.literal(14),
  currency: z.literal('SAR'),
  included_users: z.number().int().nonnegative(),
  included_storage_mb: z.number().int().nonnegative(),
  included_extra_branches: z.number().int().nonnegative(),
  apps: z.array(z.strictObject({
    id: signupAppSchema,
    monthly_minor: z.number().int().positive(),
    limits: z.record(z.string(), z.number().int().nonnegative().nullable()),
  })).length(2),
})
export type SignupApp = z.infer<typeof signupAppSchema>
export type SignupOffer = z.infer<typeof signupOfferSchema>
