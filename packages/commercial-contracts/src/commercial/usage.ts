import { z } from 'zod'
import { revisionIdSchema } from './schemas.js'

/** `count` and `mebibytes` describe limit-keyed metrics (Phase 3); the first four stay for compatibility. */
export const usageUnitSchema = z.enum(['users', 'projects', 'attachment_bytes', 'extra_branches', 'count', 'mebibytes'])
export const usageFreshnessSchema = z.enum(['fresh', 'stale', 'unavailable'])
export const usageUnavailableReasonSchema = z.enum(['source_unreachable', 'timeout', 'not_collected', 'forbidden'])
/** `used` is null (never 0) when the value could not be observed; `reason` then says why. */
export const usageMetricSchema = z.strictObject({
  key: z.string().min(1), used: z.number().int().min(0).nullable(), limit: z.number().int().min(0).nullable(),
  unit: usageUnitSchema, reason: usageUnavailableReasonSchema.nullable(),
}).refine(m => (m.used === null) === (m.reason !== null), { path: ['reason'], message: 'reason iff used is null' })
export const usageSnapshotSchema = z.strictObject({
  tenant_id: z.string().min(1), observed_at: z.string().nullable(), policy_revision_id: revisionIdSchema,
  freshness: usageFreshnessSchema, metrics: z.array(usageMetricSchema),
}).refine(s => s.freshness !== 'unavailable' || s.metrics.every(m => m.used === null), { path: ['metrics'], message: 'Unavailable usage cannot carry values' })
  .refine(s => s.freshness === 'unavailable' || s.observed_at !== null, { path: ['observed_at'], message: 'observed_at required unless unavailable' })

export type UsageMetric = z.infer<typeof usageMetricSchema>
export type UsageSnapshot = z.infer<typeof usageSnapshotSchema>
