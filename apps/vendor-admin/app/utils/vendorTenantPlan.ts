/** Structurally the contract's Cadence; kept local so this util adds no contracts import (arch R5). */
type Cadence = { unit: 'month' | 'year'; count: number }

/**
 * The customer that will own the shared tenant; fulfilment enrolls this administrator.
 * `requestId` is kept for one form submission so a retried or replayed create returns the same customer.
 */
export function planTenantCustomerBody(form: { name: string; admin_name: string; admin_login: string }, requestId: string) {
  return { name: form.name.trim(), admin_name: form.admin_name.trim(), admin_login: form.admin_login.trim(), request_id: requestId }
}

/** A new-subscription quote for the plan with its included bundles; extra branches are added later. */
export function planTenantQuoteBody(customerId: string, plan: { id: string; included_bundle_revision_ids: string[]; included_users: number; included_storage_mb: number }, cadence: Cadence) {
  return { customer_id: customerId, kind: 'new' as const, plan_revision_id: plan.id, bundle_revision_ids: [...plan.included_bundle_revision_ids], cadence, requested_extra_branches: 0, requested_users: plan.included_users, requested_storage_mb: plan.included_storage_mb }
}
