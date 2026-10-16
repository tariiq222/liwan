// A workspace that has a commercial customer is part of that customer's page: /tenants/:id opens its workspace tab
// (replacing the history entry), or the operations tab when that is the one requested. A workspace without a customer
// stays on the tenant page. Any other failure (401, 5xx) is rethrown for the auth flow and the error page.
const CUSTOMER_WORKSPACE_TABS = ['workspace', 'operations']

export default defineNuxtRouteMiddleware(async (to) => {
  const tenantId = String(to.params.id)
  let customerId: string | undefined
  try {
    const page = await useRequestFetch()<{ items: { id: string; tenant_id: string | null }[] }>('/api/vendor/v1/commercial/customers', { query: { tenant_id: tenantId, limit: 1 } })
    customerId = page.items.find(customer => customer.tenant_id === tenantId)?.id
  } catch (cause) {
    const failure = cause as { statusCode?: number; status?: number; response?: { status?: number } }
    const status = failure.statusCode ?? failure.status ?? failure.response?.status
    // 404/501: the customers service has no such route yet, so the workspace has no customer to open.
    if (status === 404 || status === 501) return
    throw cause
  }
  if (!customerId) return
  const requested = Array.isArray(to.query.tab) ? to.query.tab[0] : to.query.tab
  const tab = CUSTOMER_WORKSPACE_TABS.find(name => name === requested) ?? 'workspace'
  return navigateTo({ path: `/customers/${encodeURIComponent(customerId)}`, query: { ...to.query, tab } }, { replace: true })
})
