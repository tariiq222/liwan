import { z } from 'zod'
import { normalizeWorkspaceSlug, workspaceSlugSchema } from '../workspace-slug.js'
import { pricingPolicySchema } from './schemas.js'

export const signupAppSchema = z.string().regex(/^[a-z][a-z0-9_]*$/).max(64)
export const signupAppsSchema = z.array(signupAppSchema).max(64)
  .refine(apps => new Set(apps).size === apps.length)
export const signupLimitsSchema = z.record(z.string(), z.number().int().nonnegative().nullable())
export const signupIncludedAppSchema = z.strictObject({
  id: signupAppSchema,
  name_ar: z.string().min(1),
  name_en: z.string().min(1),
  limits: signupLimitsSchema,
})
export const signupOptionalAppSchema = z.strictObject({
  id: signupAppSchema,
  name_ar: z.string().min(1),
  name_en: z.string().min(1),
  monthly_minor: z.number().int().nonnegative(),
  limits: signupLimitsSchema,
})
export const signupOfferSchema = z.strictObject({
  offer_revision: z.uuid(),
  plan_name: z.string().min(1),
  trial_days: z.number().int().min(1).max(3650),
  currency: z.string().regex(/^[A-Z]{3}$/),
  currency_exponent: z.number().int().min(0).max(4),
  base_monthly_minor: z.number().int().nonnegative(),
  tax: pricingPolicySchema.shape.tax,
  included_users: z.number().int().nonnegative(),
  included_storage_mb: z.number().int().nonnegative(),
  included_extra_branches: z.number().int().nonnegative(),
  included_apps: z.array(signupIncludedAppSchema),
  apps: z.array(signupOptionalAppSchema),
})
export type SignupApp = z.infer<typeof signupAppSchema>
export type SignupApps = z.infer<typeof signupAppsSchema>
export type SignupLimits = z.infer<typeof signupLimitsSchema>
export type SignupIncludedApp = z.infer<typeof signupIncludedAppSchema>
export type SignupOptionalApp = z.infer<typeof signupOptionalAppSchema>
export type SignupOffer = z.infer<typeof signupOfferSchema>

// The self-service signup wire (`/v1/customer/signup/*`): the form, the two codes, the workspace slug, and the wait for
// the workspace. Names and optionality follow the control plane's current routes.
export const signupChannelSchema = z.enum(['sms', 'email'])

const personOrCompanyName = (max: number) => z.string().trim().min(1).max(max)
  .refine(value => !Array.from(value).some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127))
// The mobile is stored as E.164; the visitor may type it with spaces, parentheses or a dash.
const signupMobile = z.string().trim().max(30).transform(value => value.replace(/[ ()-]/g, ''))
  .pipe(z.string().regex(/^(?:\+?966|0)?5[0-9]{8}$/))
  .transform(value => `+966${value.slice(-9)}`)

/** `POST /start`: the form the visitor submits, now with the workspace slug they chose. */
export const signupStartSchema = z.strictObject({
  offer_revision: z.uuid(),
  app_ids: signupAppsSchema,
  company_name: personOrCompanyName(200),
  admin_name: personOrCompanyName(120),
  email: z.string().trim().toLowerCase().pipe(z.email().max(100)),
  mobile: signupMobile,
  slug: workspaceSlugSchema,
  // Both are checked by the service so a missing or stale acceptance gets its own code, not a generic invalid.
  accept_terms: z.boolean().optional(),
  terms_version: z.string().trim().max(40).optional(),
  // The single-use bot-check token; a missing one gets its own code too.
  human_token: z.string().max(2048).optional(),
})
/** A new code on one channel of an open signup. */
export const signupResendSchema = z.strictObject({ signup_id: z.uuid(), channel: signupChannelSchema })
/** The six-digit code the visitor received on that channel. */
export const signupVerifySchema = z.strictObject({
  signup_id: z.uuid(), channel: signupChannelSchema, code: z.string().regex(/^[0-9]{6}$/),
})
/** Finishes a signup whose email is verified and starts the workspace. */
/** `slug` replaces the address chosen at start, for a visitor who comes back after `slug_taken` with both codes already verified. */
export const signupCompleteSchema = z.strictObject({ signup_id: z.uuid(), slug: workspaceSlugSchema.optional() })

/** A candidate slug as typed: normalized before the check, so a bad candidate comes back `invalid` rather than as a body error. */
export const slugCheckSchema = z.strictObject({
  slug: z.string().transform(normalizeWorkspaceSlug).pipe(z.string().max(60)),
})
/** Availability is decided by the control plane; an unusable slug is a normal answer, not a refusal. */
export const slugCheckResultSchema = z.enum(['available', 'unavailable', 'invalid'])

export const signupStatusRequestSchema = z.strictObject({ signup_id: z.uuid() })
/** The provisioning wait; `handoff_url` appears only once the workspace is ready to sign in to. */
export const signupStatusSchema = z.strictObject({
  state: z.enum(['preparing', 'delayed', 'failed', 'ready']),
  handoff_url: z.url().optional(),
})

export type SignupChannel = z.infer<typeof signupChannelSchema>
export type SignupStart = z.infer<typeof signupStartSchema>
export type SignupResend = z.infer<typeof signupResendSchema>
export type SignupVerify = z.infer<typeof signupVerifySchema>
export type SignupComplete = z.infer<typeof signupCompleteSchema>
export type SlugCheck = z.infer<typeof slugCheckSchema>
export type SlugCheckResult = z.infer<typeof slugCheckResultSchema>
export type SignupStatusRequest = z.infer<typeof signupStatusRequestSchema>
export type SignupStatus = z.infer<typeof signupStatusSchema>
