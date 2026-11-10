import { z } from 'zod'

const resource = z.string().regex(/^[a-z][a-z0-9_]{0,62}$/)
const digest = z.string().regex(/^[a-f0-9]{64}$/)
const label = z.string().regex(/^[a-zA-Z0-9._-]{1,100}$/)
export const tenantBindingSchema = z.strictObject({
  tenantId: z.string().regex(/^[a-z][a-z0-9_-]{0,62}$/),
  database: resource,
  filestore: resource,
  // Per-tenant binding revision, NOT global registry snapshot revision.
  registryRevision: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
})
export type TenantBinding = z.infer<typeof tenantBindingSchema>

// Preserve the existing catalog source digest / policy channel / module-feature
// envelope. This is not a Compose deployment descriptor or a catalog publisher.
export const sharedPolicySchema = z.strictObject({
  schema_version: z.literal(1), channel: z.literal('control_plane'),
  modules: z.array(z.string().regex(/^[a-z][a-z0-9_]{0,127}$/)).min(1).max(1024).refine((items) => new Set(items).size === items.length),
  features: z.record(z.string().regex(/^(?:[a-z][a-z0-9_]*\.)+[a-z][a-z0-9_]*$/).refine((key) => !/^(local_policy|support|status)\./.test(key)), z.union([z.boolean(), z.number().int().nonnegative().max(1000000000), z.null()]))
    .refine((features) => Object.hasOwn(features, 'users.limit') && Object.hasOwn(features, 'storage.limit_mb')),
})
export const packageAuthoritySchema = z.strictObject({
  schemaVersion: z.literal(2), revisionId: z.uuid(), digest,
  catalog: z.strictObject({ version: label, tier: label, sourceSha256: digest }), policy: sharedPolicySchema,
})
export type PackageAuthority = z.infer<typeof packageAuthoritySchema>
export const sharedBackupSchema = z.strictObject({
  schemaVersion: z.literal(1), backupId: z.uuid(), binding: tenantBindingSchema,
  databaseSha256: digest, filestoreSha256: digest, consistency: z.literal('verified'),
})
const common = { schemaVersion: z.literal(1), requestId: z.uuid(), binding: tenantBindingSchema }
export const sharedJobSchema = z.discriminatedUnion('operation', [
  z.strictObject({ ...common, operation: z.literal('provision'), catalog: z.strictObject({ version: label, tier: label, sourceSha256: digest }), policy: sharedPolicySchema, packageAuthority: packageAuthoritySchema.optional() }),
  z.strictObject({ ...common, operation: z.literal('backup') }),
  z.strictObject({ ...common, operation: z.literal('restore'), backup: sharedBackupSchema, approvalId: z.uuid() }),
])
export type SharedJob = z.infer<typeof sharedJobSchema>

/** Commercial reconfiguration has its own receipt protocol; legacy jobs keep
 * their existing reconciliation schema and behavior. */
export const sharedReconfigureJobSchema = z.strictObject({
  ...common, operation: z.literal('reconfigure'), controlTenantId: z.uuid(), host: z.string().min(1),
  authority: z.strictObject({
    order_id: z.uuid(), operation_id: z.uuid(), previous_revision_id: z.uuid().nullable(), target_revision_id: z.uuid(),
    entitlement: z.strictObject({ modules: sharedPolicySchema.shape.modules,
      features: z.record(z.string(), z.union([z.boolean(), z.number().int().nonnegative(), z.null()])),
      digest, compiler_version: z.union([z.string(), z.number().int()]) }),
    branches: z.strictObject({ apply: z.array(z.strictObject({ branch_id: z.uuid(), name: z.string().min(1).max(120) })), archive: z.array(z.uuid()), restore: z.array(z.uuid()).optional() }),
    // Commercial subscription expiry written by the control plane; the classification
    // cutoff `valid_until` stays untouched. Optional so older jobs still parse.
    commercial_valid_until: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
    commercial_valid_until_revision: z.number().int().nonnegative().optional(),
    trial_ends_at: z.iso.datetime({ offset: true }).nullable().optional(),
    post_trial_features: z.record(z.string(), z.union([z.boolean(), z.number().int().nonnegative(), z.null()])).optional(),
    post_trial_modules: sharedPolicySchema.shape.modules.optional(),
    post_trial_digest: digest.optional(),
    excess_settle: z.literal(true).optional(),
    recoverable_predecessors: z.array(z.strictObject({ revision_id: z.uuid(), digest })).min(1)
      .refine(values => new Set(values.map(value => value.revision_id)).size === values.length).optional(),
    // Set only by the control plane's AI push: the job changes nothing but the derived AI keys of the already applied
    // revision, and is authorized by that revision rather than by the payment state of the order that created it.
    ai_push: z.literal(true).optional(),
    ai_expected_post_trial_digest: digest.optional(),
  }),
  restore: z.boolean().optional(), restoreId: z.uuid().optional(), origin: z.literal('trial-end').optional(),
}).refine(job => {
  const a = job.authority
  const fallback = [a.post_trial_features, a.post_trial_modules, a.post_trial_digest]
  if (a.recoverable_predecessors && (job.origin !== 'trial-end' || job.restore || job.restoreId || a.ai_push
    || a.excess_settle !== true || a.trial_ends_at !== null)) return false
  if (a.trial_ends_at) return fallback.every(value => value !== undefined) && !a.ai_push && !a.ai_expected_post_trial_digest
  return fallback.every(value => value === undefined) && (a.ai_expected_post_trial_digest === undefined || a.ai_push === true)
}, { message: 'Incomplete or unauthorized trial fallback' })
export type SharedReconfigureJob = z.infer<typeof sharedReconfigureJobSchema>
export const sharedQueuedJobSchema = z.union([sharedJobSchema, sharedReconfigureJobSchema])
export const sharedJournalSchema = z.strictObject({
  schemaVersion: z.literal(1), job: sharedJobSchema,
  attemptId: z.uuid(), sequence: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  stage: z.enum(['prepared', 'started', 'verified', 'needs_intervention', 'waiting_commercial_reconcile']),
})
export const sharedReceiptSchema = z.strictObject({
  schemaVersion: z.literal(1), operation: z.enum(['provision', 'backup', 'restore']),
  binding: tenantBindingSchema, businessKey: z.string().min(1).max(256), payloadDigest: digest,
  attemptId: z.uuid(), sequence: z.number().int().positive().max(Number.MAX_SAFE_INTEGER), status: z.literal('verified'),
})
export const sharedObservationSchema = z.discriminatedUnion('state', [
  z.strictObject({ state: z.literal('absent') }),
  z.strictObject({ state: z.literal('unknown') }),
  z.strictObject({ state: z.literal('partial') }),
  z.strictObject({ state: z.literal('present'), binding: tenantBindingSchema, businessKey: z.string().min(1).max(256), payloadDigest: digest, verified: z.boolean() }),
])
