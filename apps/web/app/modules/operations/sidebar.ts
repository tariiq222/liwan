import { OperationRequestListSchema } from '@liwan/contracts'
import { operationRequestListParams } from '../../composables/operations/useOperations'
import { normalizedPath } from '../../utils/routePath'
import type { AppSearchApi, AppSidebarMenu, AppSidebarRoute } from '../types'

const onPath = (route: AppSidebarRoute, path: string) => normalizedPath(route.path) === path

/**
 * The operations sidebar: one flat level with the pinned create action and capability-gated live totals
 * for mine (work), pending review, and monitoring. No recent-records section.
 */
export const operationsSidebar: AppSidebarMenu = {
  create: 'new-operation',
  rows: [
    {
      id: 'operation-mine',
      labelKey: 'operations.nav.mine',
      icon: 'i-lucide-files',
      to: { path: '/operations' },
      capability: 'operations.requests.read',
      active: route => {
        const path = normalizedPath(route.path)
        return path === '/operations' || path === '/operations/new' || /^\/operations\/\d+(?:\/|$)/.test(path)
      },
    },
    {
      id: 'operation-pending',
      labelKey: 'operations.nav.pending',
      icon: 'i-lucide-list-checks',
      to: { path: '/operations/pending' },
      capability: 'operations.requests.read',
      active: route => onPath(route, '/operations/pending'),
    },
    {
      id: 'operation-monitoring',
      labelKey: 'operations.nav.monitoring',
      icon: 'i-lucide-eye',
      to: { path: '/operations/monitoring' },
      capability: 'operations.monitoring.read',
      active: route => onPath(route, '/operations/monitoring'),
    },
  ],
  counts: [
    {
      capability: 'operations.requests.read',
      queryKey: ['operations', 'requests', 'sidebar', 'counts', 'requests'],
      async load(api: AppSearchApi) {
        const [mine, pending] = await Promise.all([
          api('/api/v1/operations/requests', { query: { ...operationRequestListParams('mine', false), limit: 1 }, schema: OperationRequestListSchema }),
          api('/api/v1/operations/requests', { query: { ...operationRequestListParams('pending', false), limit: 1 }, schema: OperationRequestListSchema }),
        ])
        return {
          'operation-mine': mine.total,
          'operation-pending': pending.total,
        }
      },
    },
    {
      capability: 'operations.monitoring.read',
      queryKey: ['operations', 'requests', 'sidebar', 'counts', 'monitoring'],
      async load(api: AppSearchApi) {
        const monitoring = await api('/api/v1/operations/requests', { query: { ...operationRequestListParams('monitoring', false), limit: 1 }, schema: OperationRequestListSchema })
        return { 'operation-monitoring': monitoring.total }
      },
    },
  ],
}
