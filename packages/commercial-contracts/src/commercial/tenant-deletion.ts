import { z } from 'zod'

/** The customer's own request to delete its workspace: asked, confirmed with an emailed code (the withdrawal window runs), withdrawn, or due. */
export const tenantDeletionStateSchema = z.enum(['requested', 'confirmed', 'withdrawn', 'due'])
/** The days between the confirmation and the day the deletion falls due: the window in which the request can be withdrawn. Owner decision 2026-11-13: 90, because a customer may come back at any time. Nobody can shorten it. */
export const TENANT_DELETION_WINDOW_DAYS = 90
export const tenantDeletionCodeSchema = z.string().regex(/^\d{6}$/)

/** What the tenant sees: the state and its dates. `code_expires_at` is set only while the emailed code can still be used. */
export const tenantDeletionSchema = z.strictObject({
  state: z.enum(['requested', 'confirmed', 'due']),
  requested_at: z.string(),
  code_expires_at: z.string().nullable(),
  confirmed_at: z.string().nullable(),
  due_at: z.string().nullable(),
})
/** The vendor sees every request, withdrawn ones included, with what happened to the renewal. */
export const tenantDeletionRequestSchema = z.strictObject({
  id: z.uuid(), customer_id: z.uuid(), state: tenantDeletionStateSchema,
  requested_at: z.string(), requested_by: z.string(),
  confirmed_at: z.string().nullable(), due_at: z.string().nullable(), due_marked_at: z.string().nullable(),
  withdrawn_at: z.string().nullable(), withdrawn_by: z.enum(['customer', 'vendor']).nullable(), withdraw_reason: z.string().nullable(),
  renewal_outcome: z.enum(['cancelled', 'already_cancelled', 'not_cancellable']).nullable(),
  renewal_refusal: z.string().nullable(),
})
export const tenantDeletionRequestListSchema = z.strictObject({ items: z.array(tenantDeletionRequestSchema), total: z.number().int().min(0) })
export type TenantDeletion = z.infer<typeof tenantDeletionSchema>
export type TenantDeletionRequest = z.infer<typeof tenantDeletionRequestSchema>
