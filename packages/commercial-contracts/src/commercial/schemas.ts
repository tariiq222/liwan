import { z } from 'zod'

const MAX = Number.MAX_SAFE_INTEGER
const dotted = /^(?:[a-z][a-z0-9_]*\.)+[a-z][a-z0-9_]*$/
const text = z.string().trim().min(1).max(2000)
const reason = z.string().trim().min(3).max(1000)
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
const sha = z.string().regex(/^[a-f0-9]{64}$/)

export const revisionIdSchema = z.uuid()
export const moneySchema = z.strictObject({
  currency: z.string().regex(/^[A-Z]{3}$/), exponent: z.number().int().min(0).max(4),
  minor: z.number().int().min(0).max(MAX),
})
export const cadenceSchema = z.strictObject({ unit: z.enum(['month', 'year']), count: z.number().int().min(1).max(12) })
export const capacityMapSchema = z.record(z.string().regex(dotted), z.number().int().min(0).max(MAX).nullable())
/** The first customer administrator always counts against users.limit, so a sellable limit must admit
 * them: a positive integer, or null for unlimited. One rule for packages, plans, terms and the compiler. */
export const USERS_LIMIT_KEY = 'users.limit'
export const admitsRequiredAdmin = (value: unknown) => value === null || (Number.isInteger(value) && (value as number) >= 1)
/** A6: `storage_step_mb` and its siblings are `integer` columns in PostgreSQL — not bigint — so a larger value is a
 * 500 (22003 numeric out of range) rather than a validation error. Bound them where they are parsed.
 * Two tebibytes of a step is far beyond any plan and well inside the 4-byte range the column allows. */
export const MAX_STORAGE_STEP_MB = 2 * 1024 * 1024
export const storageStepSchema = z.number().int().min(1).max(MAX_STORAGE_STEP_MB)
/**
 * A6: the exact storage-step rule, shared by the zod schema, `planIssues` and the database CHECK.
 *
 * An extra storage amount is legal when it is a whole number of the step that applies to it (the small step below
 * `storage_step_threshold_mb`, the large step from it). The plan must therefore make every step it advertises actually
 * reachable:
 *   1. all three values are positive whole megabytes;
 *   2. `storage_large_step_mb >= storage_step_mb` and `storage_step_threshold_mb >= storage_step_mb` (the small step
 *      must not overshoot the threshold on its first application, or the range below it has no buyable size);
 *   3. `storage_step_threshold_mb % storage_step_mb === 0`: the small-step range must end exactly on the threshold;
 *   4. `storage_step_threshold_mb % storage_large_step_mb === 0`: the threshold is itself the first large-step size, so
 *      it must be a whole number of large steps, or the engine offers the threshold and then refuses it.
 * With 10 GiB / 100 GiB / 100 GiB (the seeds) all four hold: extras are 10…100 GiB in 10 GiB steps, then 200 GiB and up.
 */
export function storageStepsAligned(steps: { storage_step_mb: number; storage_step_threshold_mb: number; storage_large_step_mb: number }): boolean {
  const { storage_step_mb: small, storage_step_threshold_mb: threshold, storage_large_step_mb: large } = steps
  if (![small, threshold, large].every(v => Number.isSafeInteger(v) && v > 0)) return false
  if (large < small || threshold < small) return false
  return threshold % small === 0 && threshold % large === 0
}

/**
 * A6: whether one extra-storage amount is a size the plan sells. Below the threshold the small step applies; from the
 * threshold the large step does. `compileEntitlements` and `computeQuote` both call this, so a quantity that reaches a
 * subscription snapshot is one a quote could have produced.
 */
export function fitsStorageSteps(extraMb: number, plan: { storage_step_mb: number; storage_step_threshold_mb: number; storage_large_step_mb: number }): boolean {
  if (extraMb <= 0) return true
  const step = extraMb < plan.storage_step_threshold_mb ? plan.storage_step_mb : plan.storage_large_step_mb
  return extraMb % step === 0
}
/** Release 1 sells at most this many users per company (owner decision 2026-11-06). Above it a customer is told to
 * contact us; no quote, order, change or renewal may ask for more, and no entitlement may carry more. */
export const MAX_USERS = 100
/** A user count inside the cap. `null` (unlimited) is NOT inside it: the release says at most 100, so unlimited is
 * above it by definition, and accepting it here would let a plan or terms revision reopen an uncapped tenant. */
export const usersWithinCap = (value: unknown) => Number.isInteger(value) && (value as number) >= 0 && (value as number) <= MAX_USERS
/** Plan platform limits and customer terms limits, stored and input alike. schema_023 holds the `users.limit` half of
 * the rule in the database (it must admit the customer administrator); the 100-user sales cap is enforced by the
 * contract schemas and the compiler only, because it is a commercial decision, not a stored-data invariant. */
export const sellableLimitsSchema = capacityMapSchema.refine(m => !Object.hasOwn(m, USERS_LIMIT_KEY) || admitsRequiredAdmin(m[USERS_LIMIT_KEY]), {
  message: 'users.limit must allow the required customer administrator', path: [USERS_LIMIT_KEY],
}).refine(m => !Object.hasOwn(m, USERS_LIMIT_KEY) || usersWithinCap(m[USERS_LIMIT_KEY]), {
  message: `users.limit must not exceed ${MAX_USERS} users`, path: [USERS_LIMIT_KEY],
})
export const lifecycleSchema = z.enum(['draft', 'validated', 'published'])
export const audienceSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('public') }),
  z.strictObject({ kind: z.literal('customer'), customer_id: z.string().min(1).max(100) }),
])
export const selectionSchema = z.strictObject({ app_id: z.string().regex(/^[a-z][a-z0-9_]*$/), feature_keys: z.array(z.string().regex(dotted)) })
export const catalogFeatureSchema = z.strictObject({
  key: z.string().regex(dotted), kind: z.enum(['boolean', 'limit']), selectable: z.boolean(),
  requires: z.array(z.string().regex(dotted)), enforcement_refs: z.array(z.string().min(1)),
  ceiling: z.number().int().min(0).max(1_000_000_000).optional(),
}).refine((feature) => feature.kind === 'limit' || feature.ceiling === undefined, {
  message: 'Only limit features may declare a ceiling', path: ['ceiling'],
})
export const catalogApplicationSchema = z.strictObject({
  id: z.string().regex(/^[a-z][a-z0-9_]*$/), name_ar: z.string().min(1), name_en: z.string().min(1),
  modules: z.array(z.string()), requires_apps: z.array(z.string()), conflicts_with_apps: z.array(z.string()),
  /** A bundle may grant this application: the core tier is always included, every other tier may be selected. */
  selectable: z.boolean(),
  /** A customer may buy this application. Omitted means it is not for sale: a catalog that predates the flag, or a
   * tier the release installs without selling. The current release states it on every non-core tier. */
  sellable: z.boolean().optional(), features: z.array(catalogFeatureSchema),
})
export const catalogReleaseSchema = z.strictObject({
  id: revisionIdSchema, version: z.string().min(1).max(100), source_digest: sha, artifact_digest: sha,
  base_modules: z.array(z.string()).optional(), applications: z.array(catalogApplicationSchema),
})
export const priceSchema = z.strictObject({ cadence: cadenceSchema, amount: moneySchema })

const revisionBase = {
  id: revisionIdSchema, version: z.number().int().positive(), edit_revision: z.number().int().positive(),
  name: z.string().min(1).max(200), status: lifecycleSchema, available: z.boolean(), audience: audienceSchema,
  prices: z.array(priceSchema),
}
export const bundleRevisionSchema = z.strictObject({
  ...revisionBase, bundle_id: z.string(), description: z.string(), catalog_release_id: revisionIdSchema,
  selections: z.array(selectionSchema), domain_limits: capacityMapSchema,
})
/**
 * A6: refuse misaligned storage steps at parse time as an issue on the threshold field, exactly as `planIssues` does,
 * so a plan that would violate the database CHECK is a structured 422 rather than a 500. Applied to the create and edit
 * inputs (the write paths); stored rows are read back through `planRevisionSchema`, which stays a plain object so views
 * can `.extend()` it, and `planIssues` validates an existing row before it can be published.
 */
function withAlignedStorageSteps<T extends z.ZodType<{ storage_step_mb: number; storage_step_threshold_mb: number; storage_large_step_mb: number }>>(schema: T) {
  return schema.superRefine((value, ctx) => {
    if (storageStepsAligned(value)) return
    ctx.addIssue({ code: 'custom', message: 'storage steps must tile the range they govern', path: ['storage_step_threshold_mb'] })
  })
}
export const planRevisionSchema = z.strictObject({
  ...revisionBase, plan_id: z.string(), term_months: z.number().int().positive().max(120),
  platform_limits: sellableLimitsSchema, included_bundle_revision_ids: z.array(revisionIdSchema),
  optional_bundle_revision_ids: z.array(revisionIdSchema), included_extra_branches: z.number().int().min(0).max(MAX),
  extra_branch_prices: z.array(priceSchema), extra_branches_limit: z.number().int().min(0).max(MAX).nullable(),
  included_users: z.number().int().min(0).max(MAX), included_storage_mb: z.number().int().min(0).max(MAX),
  // A11: how extra storage is bought. Small steps below the threshold, large steps above it.
  // A6: integer columns, and every value must be one the plan can actually sell.
  storage_step_mb: storageStepSchema, storage_step_threshold_mb: storageStepSchema,
  storage_large_step_mb: storageStepSchema,
  user_prices: z.array(priceSchema), storage_prices: z.array(priceSchema),
  policy_revision_id: revisionIdSchema, currency: z.string().regex(/^[A-Z]{3}$/),
  trial_days: z.number().int().min(0).max(3650), grace_days: z.number().int().min(0).max(3650),
  auto_suspend: z.boolean(), auto_renew_allowed: z.boolean(),
})
const METERED_LIMIT_KEYS = [USERS_LIMIT_KEY, 'storage.limit_mb']
/** Terms negotiate prices and non-capacity limits; users and storage stay the customer's chosen quantities. */
const termsLimitsSchema = sellableLimitsSchema.superRefine((m, ctx) => {
  for (const k of METERED_LIMIT_KEYS) if (Object.hasOwn(m, k))
    ctx.addIssue({ code: 'custom', message: 'users and storage are chosen quantities, not terms limits', path: [k] })
})
export const customerTermsRevisionSchema = z.strictObject({
  id: revisionIdSchema, customer_id: z.string(), reason,
  base_price: priceSchema.optional(), bundle_prices: z.record(revisionIdSchema, priceSchema).optional(),
  included_extra_branches: z.number().int().min(0).max(MAX).optional(), extra_branch_price: priceSchema.optional(),
  extra_branches_limit: z.number().int().min(0).max(MAX).nullable().optional(), limits: termsLimitsSchema.optional(),
  term_months: z.number().int().positive().max(120).optional(), cadence: cadenceSchema.optional(),
})
export const entitlementSnapshotSchema = z.strictObject({
  catalog_release_id: revisionIdSchema, modules: z.array(z.string()),
  features: z.record(z.string(), z.union([z.boolean(), z.number().int(), z.null()])),
  compiler_version: z.string(), digest: sha,
})
export const pricingPolicySchema = z.strictObject({
  id: revisionIdSchema, timezone: z.literal('Asia/Riyadh'), rounding: z.literal('half_up_per_line'),
  tax: z.discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('vat_exclusive'), rate_bps: z.literal(1500) }),
    z.strictObject({ kind: z.literal('none') }),
  ]),
})
export const quoteLineSchema = z.strictObject({
  key: z.string(), kind: z.enum(['base', 'bundle', 'branch', 'users', 'storage', 'onboarding', 'discount', 'tax', 'adjustment']),
  timing: z.enum(['now', 'renewal']), description: z.string(), quantity: z.number().int().min(0).max(MAX),
  amount: moneySchema, period_start: isoDate, period_end: isoDate, source_revision_id: revisionIdSchema,
})
export const quoteSchema = z.strictObject({
  id: z.string(), customer_id: z.string(), subscription_id: z.string().nullable(),
  expected_subscription_revision: z.number().int().min(0), plan_revision_id: revisionIdSchema,
  bundle_revision_ids: z.array(revisionIdSchema), terms_revision_id: revisionIdSchema.nullable(),
  entitlement_digest: sha, requested_extra_branches: z.number().int().min(0).max(MAX),
  requested_users: z.number().int().min(0).max(MAX), requested_storage_mb: z.number().int().min(0).max(MAX), cadence: cadenceSchema,
  effective_date: isoDate, policy_revision_id: revisionIdSchema, lines: z.array(quoteLineSchema),
  due_now: moneySchema, next_renewal: moneySchema, next_renewal_at: isoDate, expires_at: z.string(), digest: sha,
})

// Inputs
const bundleFields = {
  name: z.string().trim().min(1).max(200), description: text, audience: audienceSchema,
  catalog_release_id: revisionIdSchema, selections: z.array(selectionSchema), domain_limits: capacityMapSchema,
  prices: z.array(priceSchema),
}
export const bundleCreateSchema = z.strictObject({ ...bundleFields, reason: reason.optional() })
export const bundleEditSchema = z.strictObject({ ...bundleFields, edit_revision: z.number().int().positive().max(MAX), reason })
const planFields = {
  name: z.string().trim().min(1).max(200), audience: audienceSchema, term_months: z.number().int().positive().max(120),
  currency: z.string().regex(/^[A-Z]{3}$/), prices: z.array(priceSchema), platform_limits: sellableLimitsSchema,
  included_bundle_revision_ids: z.array(revisionIdSchema), optional_bundle_revision_ids: z.array(revisionIdSchema),
  included_extra_branches: z.number().int().min(0).max(MAX), extra_branch_prices: z.array(priceSchema),
  extra_branches_limit: z.number().int().min(0).max(MAX).nullable(),
  included_users: z.number().int().min(0).max(MAX), included_storage_mb: z.number().int().min(0).max(MAX),
  // A6: integer columns, and every value must be one the plan can actually sell.
  storage_step_mb: storageStepSchema, storage_step_threshold_mb: storageStepSchema,
  storage_large_step_mb: storageStepSchema,
  user_prices: z.array(priceSchema), storage_prices: z.array(priceSchema), policy_revision_id: revisionIdSchema,
  trial_days: z.number().int().min(0).max(3650), grace_days: z.number().int().min(0).max(3650),
  auto_suspend: z.boolean(), auto_renew_allowed: z.boolean(),
}
export const planCreateSchema = withAlignedStorageSteps(z.strictObject({ ...planFields, reason: reason.optional() }))
export const planEditSchema = withAlignedStorageSteps(z.strictObject({ ...planFields, edit_revision: z.number().int().positive().max(MAX), reason }))
export const lifecycleActionSchema = z.strictObject({ edit_revision: z.number().int().positive().max(MAX), reason })
export const listEnvelopeSchema = <T extends z.ZodType>(item: T) =>
  z.strictObject({ items: z.array(item), total: z.number().int().min(0) })
// Ids only: totals, tax and prices are never accepted from the caller.
export const quoteRequestSchema = z.strictObject({
  kind: z.enum(['new', 'change']), plan_revision_id: revisionIdSchema, bundle_revision_ids: z.array(revisionIdSchema),
  terms_revision_id: revisionIdSchema.nullable().optional(), cadence: cadenceSchema,
  requested_extra_branches: z.number().int().min(0).max(MAX),
  requested_users: z.number().int().min(0).max(MAX), requested_storage_mb: z.number().int().min(0).max(MAX),
  subscription_id: z.string().nullable().optional(), expected_subscription_revision: z.number().int().min(0).optional(),
  effective_date: isoDate.optional(),
  /** The optional one-time assisted onboarding on a first order; the vendor's own fee prices it. */
  onboarding: z.boolean().optional(),
})

export type RevisionId = z.infer<typeof revisionIdSchema>
export type Money = z.infer<typeof moneySchema>
export type Cadence = z.infer<typeof cadenceSchema>
export type CapacityMap = z.infer<typeof capacityMapSchema>
export type Lifecycle = z.infer<typeof lifecycleSchema>
export type Audience = z.infer<typeof audienceSchema>
export type Selection = z.infer<typeof selectionSchema>
export type CatalogFeature = z.infer<typeof catalogFeatureSchema>
export type CatalogApplication = z.infer<typeof catalogApplicationSchema>
export type CatalogRelease = z.infer<typeof catalogReleaseSchema>
export type Price = z.infer<typeof priceSchema>
export type BundleRevision = z.infer<typeof bundleRevisionSchema>
export type PlanRevision = z.infer<typeof planRevisionSchema>
export type CustomerTermsRevision = z.infer<typeof customerTermsRevisionSchema>
export type EntitlementSnapshot = z.infer<typeof entitlementSnapshotSchema>
export type PricingPolicy = z.infer<typeof pricingPolicySchema>
export type QuoteLine = z.infer<typeof quoteLineSchema>
export type Quote = z.infer<typeof quoteSchema>
export type BundleCreate = z.infer<typeof bundleCreateSchema>
export type BundleEdit = z.infer<typeof bundleEditSchema>
export type PlanCreate = z.infer<typeof planCreateSchema>
export type PlanEdit = z.infer<typeof planEditSchema>
export type LifecycleAction = z.infer<typeof lifecycleActionSchema>
export type QuoteRequest = z.infer<typeof quoteRequestSchema>
