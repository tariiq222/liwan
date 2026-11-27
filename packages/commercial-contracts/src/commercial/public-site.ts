import { z } from 'zod'

const amount = z.number().nonnegative()
const prices = { monthly: amount, annual: amount.nullable() }

/** What the marketing site reads: `GET /api/commercial/public/pricing`. Amounts are whole currency units without tax; the
 * vendor edits them in the console and this shape never carries an id, a cost or a revision. */
export const publicPricingSchema = z.strictObject({
  schema_version: z.literal(1),
  currency: z.string().regex(/^[A-Z]{3}$/),
  tax: z.enum(['none', 'vat_exclusive']),
  tax_rate_bps: z.number().int().positive().max(100_000).optional(),
  trial_days: z.number().int().nonnegative().max(3650),
  base: z.strictObject({ ...prices }),
  free: z.strictObject({ users: z.number().int().nonnegative(), storage_gb: amount, branches: z.number().int().nonnegative(), apps: z.array(z.string()) }),
  apps: z.array(z.strictObject({ key: z.string(), name_ar: z.string(), name_en: z.string(), ...prices })),
  extra_user: z.strictObject({ ...prices, max_users: z.number().int().positive() }),
  extra_storage: z.strictObject({
    per_gb_monthly: amount, block_gb: z.number().positive(), block_monthly: amount,
    step_gb: z.number().positive(), step_gb_after: z.number().positive(), step_gb_large: z.number().positive(),
  }),
  onboarding: z.strictObject({ one_time: amount }),
  refund_days: z.number().int().nonnegative(),
}).refine(
  v => (v.tax === 'none' && v.tax_rate_bps === undefined) || (v.tax === 'vat_exclusive' && v.tax_rate_bps !== undefined),
  { message: 'tax_rate_bps is required iff tax is vat_exclusive', path: ['tax_rate_bps'] },
)
export type PublicPricing = z.infer<typeof publicPricingSchema>

/** Empty text from a form is "not given". */
const optionalText = (max: number) => z.string().trim().max(max).optional().transform(value => value || undefined)
const utm = optionalText(200)

/** The marketing site's contact form: `POST /api/commercial/public/contact`. Unknown fields are dropped, never stored. */
export const publicContactSchema = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.string().trim().toLowerCase().pipe(z.email().max(254)),
  company: optionalText(200),
  mobile: z.string().trim().optional().transform(value => value || undefined).pipe(z.string().regex(/^\+[1-9][0-9]{7,14}$/).optional()),
  users: z.number().int().min(1).max(100_000).optional(),
  message: z.string().trim().min(1).max(2000),
  lang: z.enum(['ar', 'en']).default('ar'),
  consent: z.literal(true),
  turnstile_token: z.string().min(1).max(2048),
  utm_source: utm, utm_medium: utm, utm_campaign: utm, utm_term: utm, utm_content: utm,
})
export type PublicContact = z.infer<typeof publicContactSchema>
