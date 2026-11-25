import { HelpdeskSummarySchema } from '@liwan/contracts'
import { normalizedPath } from '../../utils/routePath'
import type { AppSearchApi, AppSidebarMenu, AppSidebarRoute } from '../types'

const onPath = (route: AppSidebarRoute, path: string) => normalizedPath(route.path) === path
const insidePath = (route: AppSidebarRoute, path: string) => onPath(route, path) || normalizedPath(route.path).startsWith(`${path}/`)
const isUnassigned = (route: AppSidebarRoute) => onPath(route, '/helpdesk') && route.query.assignee === 'none'
const isMine = (route: AppSidebarRoute) => onPath(route, '/helpdesk') && route.query.assignee === 'me'

/**
 * The helpdesk sidebar: pinned create action, the tickets queue with its agent slices (open, unassigned, mine)
 * counted from `/api/v1/helpdesk/summary`, and support reports.
 */
export const helpdeskSidebar: AppSidebarMenu = {
  create: 'helpdesk-new',
  rows: [
    {
      id: 'helpdesk-tickets',
      labelKey: 'helpdesk.nav.tickets',
      icon: 'i-lucide-life-buoy',
      to: { path: '/helpdesk' },
      capability: 'helpdesk.requests.read',
      anyCapabilities: ['helpdesk.tickets.read'],
      active: route => (onPath(route, '/helpdesk') || onPath(route, '/helpdesk/new')) && !isUnassigned(route) && !isMine(route),
    },
    {
      id: 'helpdesk-unassigned',
      labelKey: 'helpdesk.filters.unassigned',
      icon: 'i-lucide-user-round-x',
      to: { path: '/helpdesk', query: { assignee: 'none' } },
      capability: 'helpdesk.tickets.read',
      active: isUnassigned,
    },
    {
      id: 'helpdesk-mine',
      labelKey: 'helpdesk.filters.mine',
      icon: 'i-lucide-user-round-check',
      to: { path: '/helpdesk', query: { assignee: 'me' } },
      capability: 'helpdesk.tickets.read',
      active: isMine,
    },
    {
      id: 'helpdesk-reports',
      labelKey: 'helpdesk.nav.reports',
      icon: 'i-lucide-chart-column',
      to: { path: '/helpdesk/reports' },
      capability: 'helpdesk.reports.read',
      active: route => insidePath(route, '/helpdesk/reports'),
    },
  ],
  counts: [
    {
      capability: 'helpdesk.tickets.read',
      queryKey: ['helpdesk', 'summary', 'sidebar'],
      async load(api: AppSearchApi) {
        const summary = await api('/api/v1/helpdesk/summary', { schema: HelpdeskSummarySchema })
        return {
          'helpdesk-tickets': summary.open,
          'helpdesk-unassigned': summary.unassigned,
          'helpdesk-mine': summary.mine,
        }
      },
    },
  ],
}
