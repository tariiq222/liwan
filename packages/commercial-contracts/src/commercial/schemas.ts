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
/** Plan platform limits and customer terms limits, stored and input alike; schema_023 holds the same rule in the database. */
export const sellableLimitsSchema = capacityMapSchema.refine(m => !Object.hasOwn(m, USERS_LIMIT_KEY) || admitsRequiredAdmin(m[USERS_LIMIT_KEY]), {
  message: 'users.limit must allow the required customer administrator', path: [USERS_LIMIT_KEY],
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
  selectable: z.boolean(), features: z.array(catalogFeatureSchema),
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
export const planRevisionSchema = z.strictObject({
  ...revisionBase, plan_id: z.string(), term_months: z.number().int().positive().max(120),
  platform_limits: sellableLimitsSchema, included_bundle_revision_ids: z.array(revisionIdSchema),
  optional_bundle_revision_ids: z.array(revisionIdSchema), included_extra_branches: z.number().int().min(0).max(MAX),
  extra_branch_prices: z.array(priceSchema), extra_branches_limit: z.number().int().min(0).max(MAX).nullable(),
  policy_revision_id: revisionIdSchema, currency: z.string().regex(/^[A-Z]{3}$/),
  trial_days: z.number().int().min(0).max(3650), grace_days: z.number().int().min(0).max(3650),
  auto_suspend: z.boolean(), auto_renew_allowed: z.boolean(),
})
export const customerTermsRevisionSchema = z.strictObject({
  id: revisionIdSchema, customer_id: z.string(), reason,
  base_price: priceSchema.optional(), bundle_prices: z.record(revisionIdSchema, priceSchema).optional(),
  included_extra_branches: z.number().int().min(0).max(MAX).optional(), extra_branch_price: priceSchema.optional(),
  extra_branches_limit: z.number().int().min(0).max(MAX).nullable().optional(), limits: sellableLimitsSchema.optional(),
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
  key: z.string(), kind: z.enum(['base', 'bundle', 'branch', 'discount', 'tax', 'adjustment']),
  timing: z.enum(['now', 'renewal']), description: z.string(), quantity: z.number().int().min(0).max(MAX),
  amount: moneySchema, period_start: isoDate, period_end: isoDate, source_revision_id: revisionIdSchema,
})
export const quoteSchema = z.strictObject({
  id: z.string(), customer_id: z.string(), subscription_id: z.string().nullable(),
  expected_subscription_revision: z.number().int().min(0), plan_revision_id: revisionIdSchema,
  bundle_revision_ids: z.array(revisionIdSchema), terms_revision_id: revisionIdSchema.nullable(),
  entitlement_digest: sha, requested_extra_branches: z.number().int().min(0).max(MAX), cadence: cadenceSchema,
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
  extra_branches_limit: z.number().int().min(0).max(MAX).nullable(), policy_revision_id: revisionIdSchema,
  trial_days: z.number().int().min(0).max(3650), grace_days: z.number().int().min(0).max(3650),
  auto_suspend: z.boolean(), auto_renew_allowed: z.boolean(),
}
export const planCreateSchema = z.strictObject({ ...planFields, reason: reason.optional() })
export const planEditSchema = z.strictObject({ ...planFields, edit_revision: z.number().int().positive().max(MAX), reason })
export const lifecycleActionSchema = z.strictObject({ edit_revision: z.number().int().positive().max(MAX), reason })
export const listEnvelopeSchema = <T extends z.ZodType>(item: T) =>
  z.strictObject({ items: z.array(item), total: z.number().int().min(0) })
// Ids only: totals, tax and prices are never accepted from the caller.
export const quoteRequestSchema = z.strictObject({
  kind: z.enum(['new', 'change']), plan_revision_id: revisionIdSchema, bundle_revision_ids: z.array(revisionIdSchema),
  terms_revision_id: revisionIdSchema.nullable().optional(), cadence: cadenceSchema,
  requested_extra_branches: z.number().int().min(0).max(MAX),
  subscription_id: z.string().nullable().optional(), expected_subscription_revision: z.number().int().min(0).optional(),
  effective_date: isoDate.optional(),
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
