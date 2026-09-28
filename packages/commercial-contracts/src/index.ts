import { z } from 'zod'

export const vendorCapabilitySchema = z.enum(['vendor.read', 'vendor.tenants.manage', 'vendor.catalog.manage', 'vendor.operations.run', 'vendor.audit.read'])
export type VendorCapability = z.infer<typeof vendorCapabilitySchema>
export const commercialModeSchema = z.enum(['saas', 'non_saas'])
export const hostingModelSchema = z.enum(['managed', 'customer_hosted'])
export const tenantStatusSchema = z.enum(['registered', 'provisioning', 'active', 'needs_intervention'])
export const operationStatusSchema = z.enum(['queued', 'running', 'succeeded', 'failed', 'needs_intervention'])

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
})
export type Tenant = z.infer<typeof tenantSchema>
export type Operation = z.infer<typeof operationSchema>
export type TenantCreate = z.infer<typeof tenantCreateSchema>
export type OperationRequest = z.infer<typeof operationRequestSchema>

// Shared multi-tenant provisioning contracts (t3). Subpath `@nasq/commercial-contracts/shared`
// is the canonical import; this barrel re-export keeps root-package consumers working.
export * from './shared/provisioning.js'
