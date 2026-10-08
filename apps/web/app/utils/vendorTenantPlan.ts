/** Structurally the contract's Cadence; kept local so this util adds no contracts import (arch R5). */
type Cadence = { unit: 'month' | 'year'; count: number }

/** The customer that will own the shared tenant; fulfilment enrolls this administrator. */
export function planTenantCustomerBody(form: { name: string; admin_name: string; admin_login: string }) {
  return { name: form.name.trim(), admin_name: form.admin_name.trim(), admin_login: form.admin_login.trim() }
}

/** A new-subscription quote for the plan with its included bundles; extra branches are added later. */
export function planTenantQuoteBody(customerId: string, plan: { id: string; included_bundle_revision_ids: string[] }, cadence: Cadence) {
  return { customer_id: customerId, kind: 'new' as const, plan_revision_id: plan.id, bundle_revision_ids: [...plan.included_bundle_revision_ids], cadence, requested_extra_branches: 0 }
}
