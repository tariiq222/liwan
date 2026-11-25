import { SalesOrderListSchema } from '@liwan/contracts'
import { normalizedPath } from '../../utils/routePath'
import type { AppSearchApi, AppSidebarMenu, AppSidebarRoute } from '../types'

const insidePath = (route: AppSidebarRoute, path: string) => {
  const current = normalizedPath(route.path)
  return current === path || current.startsWith(`${path}/`)
}

/**
 * The sales sidebar: pinned create action (`new-quotation`), rows for sales and reports,
 * and a live count for sales loaded with `limit: 1` under the `sales` query-key root.
 */
export const salesSidebar: AppSidebarMenu = {
  create: 'new-quotation',
  rows: [
    {
      id: 'sales', labelKey: 'sales.title', icon: 'i-lucide-receipt-text', to: { path: '/sales' },
      capability: 'sales.read',
      active: route => insidePath(route, '/sales') && !insidePath(route, '/sales/reports'),
    },
    {
      id: 'sales-reports', labelKey: 'sales.reports.title', icon: 'i-lucide-chart-column', to: { path: '/sales/reports' },
      capability: 'sales.reports.read',
      active: route => insidePath(route, '/sales/reports'),
    },
  ],
  counts: [
    {
      capability: 'sales.read',
      queryKey: ['sales', 'list', 'sidebar'],
      async load(api: AppSearchApi) {
        const result = await api('/api/v1/sales/orders', { query: { limit: 1 }, schema: SalesOrderListSchema })
        return { sales: result.total }
      },
    },
  ],
}
