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
export const sharedBackupSchema = z.strictObject({
  schemaVersion: z.literal(1), backupId: z.uuid(), binding: tenantBindingSchema,
  databaseSha256: digest, filestoreSha256: digest, consistency: z.literal('verified'),
})
const common = { schemaVersion: z.literal(1), requestId: z.uuid(), binding: tenantBindingSchema }
export const sharedJobSchema = z.discriminatedUnion('operation', [
  z.strictObject({ ...common, operation: z.literal('provision'), catalog: z.strictObject({ version: label, tier: label, sourceSha256: digest }), policy: sharedPolicySchema }),
  z.strictObject({ ...common, operation: z.literal('backup') }),
  z.strictObject({ ...common, operation: z.literal('restore'), backup: sharedBackupSchema, approvalId: z.uuid() }),
])
export type SharedJob = z.infer<typeof sharedJobSchema>
export const sharedJournalSchema = z.strictObject({
  schemaVersion: z.literal(1), job: sharedJobSchema,
  attemptId: z.uuid(), sequence: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  stage: z.enum(['prepared', 'started', 'verified', 'needs_intervention']),
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
