import { CustomerListSchema } from '@liwan/contracts'
import { normalizedPath } from '../../utils/routePath'
import type { AppSearchApi, AppSidebarMenu, AppSidebarRoute } from '../types'

const insidePath = (route: AppSidebarRoute, path: string) => {
  const current = normalizedPath(route.path)
  return current === path || current.startsWith(`${path}/`)
}

/**
 * The customers sidebar: pinned create action (`new-customer`), one row for the directory,
 * and its live server count loaded with `limit: 1` under the `customers` query-key root.
 */
export const customersSidebar: AppSidebarMenu = {
  create: 'new-customer',
  rows: [
    {
      id: 'customers', labelKey: 'customers.title', icon: 'i-lucide-contact-round', to: { path: '/customers' },
      capability: 'customers.read',
      active: route => insidePath(route, '/customers'),
    },
  ],
  counts: [
    {
      capability: 'customers.read',
      queryKey: ['customers', 'list', 'sidebar'],
      async load(api: AppSearchApi) {
        const result = await api('/api/v1/customers', { query: { limit: 1 }, schema: CustomerListSchema })
        return { customers: result.total }
      },
    },
  ],
}
