import { z } from 'zod'

/** The processes and adapters the vendor console reports on. Two report a beat; the rest report only whether they could be built. */
export const SERVICE_COMPONENTS = ['shared_worker', 'commercial_scheduler', 'payment_adapter', 'mail_adapter', 'alert_channel', 'api_payment_adapter'] as const
export const serviceComponentSchema = z.enum(SERVICE_COMPONENTS)
/** `never_seen` is a component that never wrote a row (a fresh install, or dedicated mode without the shared worker). */
export const serviceStateSchema = z.enum(['ok', 'stale', 'unavailable', 'never_seen'])

/** `since` is when the reporting process started; `last_beat_at` when it was last heard from. `detail` holds fixed codes only and is null for a caller without `vendor.operations.run`. */
export const serviceHealthItemSchema = z.strictObject({
  component: serviceComponentSchema,
  state: serviceStateSchema,
  since: z.iso.datetime().nullable(),
  last_beat_at: z.iso.datetime().nullable(),
  detail: z.record(z.string(), z.unknown()).nullable(),
})
export const serviceHealthSchema = z.array(serviceHealthItemSchema).refine(items => new Set(items.map(i => i.component)).size === items.length, 'one entry per component')

export type ServiceComponent = z.infer<typeof serviceComponentSchema>
export type ServiceState = z.infer<typeof serviceStateSchema>
export type ServiceHealthItem = z.infer<typeof serviceHealthItemSchema>

/** `GET /v1/overview`: the queue and workspace counts, and the health of the services, which is null when the table could not be read (the counts never depend on it). */
export const vendorOverviewSchema = z.strictObject({
  tenants: z.number().int().min(0),
  active: z.number().int().min(0),
  pending_operations: z.number().int().min(0),
  failed_operations: z.number().int().min(0),
  last_health_at: z.iso.datetime().nullable(),
  health: serviceHealthSchema.nullable(),
})
export type VendorOverview = z.infer<typeof vendorOverviewSchema>
