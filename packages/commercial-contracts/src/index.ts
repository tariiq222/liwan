import { z } from 'zod'

export const commercialModeSchema = z.enum(['saas', 'non_saas'])
export const hostingModelSchema = z.enum(['managed', 'customer_hosted'])
export const tenantStatusSchema = z.enum(['registered', 'provisioning', 'active', 'needs_intervention'])
export const operationStatusSchema = z.enum(['queued', 'running', 'succeeded', 'failed', 'needs_intervention'])

// The `status` filter of the vendor operation list: one status of either queue, or a group. The groups match the
// overview counts: `pending` is queued + running, `attention` is failed + needs_intervention.
const OPERATION_STATUS_GROUPS = { pending: ['queued', 'running'], attention: ['failed', 'needs_intervention'] } as const
export const operationListStatusSchema = z.enum(['queued', 'running', 'succeeded', 'failed', 'needs_intervention', 'verified', 'pending', 'attention'])
export type OperationListStatus = z.infer<typeof operationListStatusSchema>
/** The statuses a list filter value stands for. */
export function operationStatusesOf(filter: OperationListStatus): string[] {
  return filter === 'pending' || filter === 'attention' ? [...OPERATION_STATUS_GROUPS[filter]] : [filter]
}

const reason = z.string().trim().min(3).max(1000)
const inventoryId = z.string().regex(/^[a-z][a-z0-9._-]{0,63}$/)
const featureValue = z.union([z.boolean(), z.number().int().nonnegative(), z.null()])
const features = z.record(z.string().regex(/^(?:[a-z][a-z0-9_]*\.)+[a-z][a-z0-9_]*$/).refine((key) => !key.startsWith('local_policy.') && !key.startsWith('support.') && !key.startsWith('status.')), featureValue)
const baseOperation = { request_id: z.uuid(), reason }

export const tenantCreateSchema = z.strictObject({
  name: z.string().trim().min(1).max(200),
  commercial_mode: commercialModeSchema,
  hosting_model: hostingModelSchema,
  inventory_target: inventoryId,
  catalog_version: z.string().min(1).max(100).optional(),
  catalog_tier: z.string().regex(/^[a-z][a-z0-9._-]{0,63}$/).optional(),
  reason,
}).refine((input) => Boolean(input.catalog_version) === Boolean(input.catalog_tier), { path: ['catalog_tier'], message: 'Catalog version and tier must be selected together' })
export const operationsGrantSchema = z.strictObject({ enabled: z.boolean(), reason })
export const operationRequestSchema = z.discriminatedUnion('type', [
  z.strictObject({ ...baseOperation, type: z.literal('tenant.create') }),
  z.strictObject({ ...baseOperation, type: z.literal('tenant.inspect') }),
  z.strictObject({ ...baseOperation, type: z.literal('health') }),
  z.strictObject({ ...baseOperation, type: z.literal('backup') }),
  z.strictObject({ ...baseOperation, type: z.literal('tenant.entitle'), expected_revision: z.number().int().nonnegative(), features }),
  z.strictObject({ ...baseOperation, type: z.literal('upgrade'), release_id: inventoryId }),
  z.strictObject({ ...baseOperation, type: z.literal('restore'), backup_id: inventoryId, approval_id: z.uuid() }),
])
export const retryRequestSchema = z.strictObject({ request_id: z.uuid(), reason })
export const reasonRequestSchema = z.strictObject({ reason })

export const tenantSchema = z.strictObject({
  id: z.uuid(), name: z.string(), commercial_mode: commercialModeSchema, hosting_model: hostingModelSchema,
  inventory_target: inventoryId, catalog_version: z.string().nullable(), catalog_tier: z.string().nullable(), status: tenantStatusSchema,
  desired_policy: z.record(z.string(), z.unknown()).nullable(), observed_policy: z.record(z.string(), z.unknown()).nullable(),
  health_checked_at: z.iso.datetime().nullable(), operations_enabled: z.boolean(), created_at: z.iso.datetime(),
  policy_revision: z.number().int().nonnegative().nullable(),
})
export const operationSchema = z.strictObject({
  id: z.uuid(), tenant_id: z.uuid(), type: z.string(), status: operationStatusSchema, stage: z.string(),
  request_id: z.uuid(), reason: z.string(), result: z.record(z.string(), z.unknown()).nullable(),
  created_at: z.iso.datetime(), updated_at: z.iso.datetime(),
  events: z.array(z.strictObject({ stage: z.string(), status: z.string(), at: z.iso.datetime() })).optional(),
  // Workspace name and owning customer, resolved by the control plane for display (absent on a bare operation row).
  tenant_name: z.string().nullable().optional(), customer_id: z.uuid().nullable().optional(),
})
export type Tenant = z.infer<typeof tenantSchema>
export type Operation = z.infer<typeof operationSchema>
export type TenantCreate = z.infer<typeof tenantCreateSchema>
export type OperationRequest = z.infer<typeof operationRequestSchema>

// Shared multi-tenant provisioning contracts (t3). Subpath `@liwan/commercial-contracts/shared`
// is the canonical import; this barrel re-export keeps root-package consumers working.
export * from './shared/provisioning.js'
export * from './admin.js'
export * from './audit.js'

export const sharedOnboardingRequestSchema = z.strictObject({
  request_id: z.uuid(), name: z.string().trim().min(1).max(200),
  catalog_version: z.string().regex(/^[a-zA-Z0-9._-]{1,100}$/).optional(), catalog_tier: z.string().regex(/^[a-z][a-z0-9._-]{0,63}$/).optional(),
  package_revision_id: z.uuid().optional(),
  admin_name: z.string().trim().min(1).max(120), admin_login: z.email().max(100), reason: z.string().trim().min(3).max(1000),
}).refine(input => input.package_revision_id ? !input.catalog_version && !input.catalog_tier : Boolean(input.catalog_version && input.catalog_tier), { path: ['package_revision_id'], message: 'Select exactly one package or catalog source' })
export const sharedOnboardingResponseSchema = z.strictObject({
  tenant_id: z.uuid(), job_id: z.uuid().nullable(), status: tenantStatusSchema, host: z.string(), replay: z.boolean(),
})
export const sharedProvisioningProgressSchema = z.strictObject({
  tenant_id: z.uuid(), job_id: z.uuid().nullable(), status: tenantStatusSchema, host: z.string(),
  admin_login: z.string(), stage: z.string(), error_code: z.string().nullable(),
})

// Additive vendor read model. Legacy operationSchema remains unchanged.
export const restorePublicationSchema = z.strictObject({
  approvalId:z.uuid(), status:z.enum(['not_requested','queued','published','needs_intervention']),
  code:z.string().nullable(), host:z.string().nullable(),
})
export const sharedOperationFeedSchema = operationSchema.extend({
  source: z.literal('shared'),
  type: z.enum(['provision', 'backup', 'restore', 'unknown']),
  status: z.enum(['queued', 'running', 'verified', 'needs_intervention']),
  stage: z.enum(['queued', 'running', 'prepared', 'started', 'verified', 'needs_intervention']),
  reason: z.enum(['shared_execution_pending', 'shared_execution_verified', 'shared_execution_needs_attention']),
  restore_publication:restorePublicationSchema.optional(),
  result: z.null(), updated_at: z.null(), last_event_at: z.iso.datetime().nullable(),
})
export const operationFeedSchema = z.discriminatedUnion('source', [
  operationSchema.extend({ source: z.literal('legacy'), last_event_at: z.null() }),
  sharedOperationFeedSchema,
])
export type OperationFeed = z.infer<typeof operationFeedSchema>

export * from './packages.js'
export * from './commercial/index.js'
export * from './commercial/feature-descriptor.js'
export * from './commercial-http.js'
