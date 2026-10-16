import { z } from 'zod'

/** The vendor client list: every commercial customer with its workspace, plus workspaces that have no customer yet. */
export const CLIENT_LIST_PAGE_SIZE = 25
export const clientStateFilters = ['awaiting_payment', 'activating', 'active', 'failed', 'inactive', 'setup_required', 'no_workspace', 'no_commercial'] as const
export const clientStateFilterSchema = z.enum(clientStateFilters)

/** `customer_id` is null for a workspace without a commercial record; `tenant_id` is null before provisioning. */
export const clientRowSchema = z.strictObject({
  customer_id: z.uuid().nullable(),
  tenant_id: z.uuid().nullable(),
  name: z.string().min(1),
  subscription_state: z.enum(['awaiting_payment', 'activating', 'active', 'failed', 'inactive']).nullable(),
  plan_name: z.string().nullable(),
  /** The plan of the latest unresolved order, before it is applied. */
  pending_plan_name: z.string().nullable(),
  renewal_at: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  setup_required: z.boolean(),
  tenant_status: z.string().nullable(),
  commercial_mode: z.enum(['saas', 'non_saas']).nullable(),
  hosting_model: z.enum(['managed', 'customer_hosted']).nullable(),
}).refine(row => row.customer_id !== null || row.tenant_id !== null, { message: 'client_without_identity' })
export const clientListSchema = z.strictObject({ items: z.array(clientRowSchema), total: z.number().int().min(0) })

export type ClientStateFilter = z.infer<typeof clientStateFilterSchema>
export type ClientRow = z.infer<typeof clientRowSchema>
export type ClientList = z.infer<typeof clientListSchema>
