import { z } from 'zod'

/** The terms a company accepted at public sign-up; the view carries it as `signup_acceptance`, null for a customer the vendor created. */
export const signupAcceptanceSchema = z.strictObject({
  terms_version: z.string().min(1).max(40),
  accepted_at: z.iso.datetime(),
})
export type SignupAcceptance = z.infer<typeof signupAcceptanceSchema>
