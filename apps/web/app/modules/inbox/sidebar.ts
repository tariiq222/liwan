import { InboxAudienceListSchema, InboxCampaignListSchema, InboxConversationListSchema } from '@liwan/contracts'
import { normalizedPath } from '../../utils/routePath'
import { inboxQueueCountsKey } from '../../utils/inboxKpis'
import type { AppSearchApi, AppSidebarMenu, AppSidebarRoute } from '../types'

const onPath = (route: AppSidebarRoute, path: string) => normalizedPath(route.path) === path
const insidePath = (route: AppSidebarRoute, path: string) => onPath(route, path) || normalizedPath(route.path).startsWith(`${path}/`)
// The conversations workspace: the list, or one conversation open beside it (its contact panel included).
const inWorkspace = (route: AppSidebarRoute) => onPath(route, '/inbox') || /^\/inbox\/\d+(?:\/|$)/.test(normalizedPath(route.path))
const assigneeOf = (route: AppSidebarRoute) => (typeof route.query.assignee === 'string' ? route.query.assignee : '')
const inAudiences = (route: AppSidebarRoute) => insidePath(route, '/inbox/campaigns/audiences')

const workSection = { id: 'inbox-work', titleKey: 'inbox.sidebar.work' } as const
const outreachSection = { id: 'inbox-outreach', titleKey: 'inbox.sidebar.outreach' } as const
const insightSection = { id: 'inbox-insight', titleKey: 'inbox.sidebar.insight' } as const

/** One open queue's `limit=1` count; its row opens the same list without the limit. */
const queueFilters = (assignee: 'unassigned' | 'me') => ({ state: 'open', assignee, limit: 1 })

/**
 * The inbox sidebar: pinned create action (`inbox-new-campaign`), the conversations workspace with the agent's two
 * open queues (unassigned, mine), the orders, the campaigns with their audiences, and the reports. The numbers are the
 * server's `limit: 1` totals of the same queries the rows open, so a number always matches the list it leads to.
 */
export const inboxSidebar: AppSidebarMenu = {
  create: 'inbox-new-campaign',
  rows: [
    {
      id: 'inbox-conversations', labelKey: 'inbox.nav.conversations', icon: 'i-lucide-messages-square', to: { path: '/inbox' },
      capability: 'inbox.conversations.read', section: workSection,
      active: route => inWorkspace(route) && !['unassigned', 'me'].includes(assigneeOf(route)),
    },
    {
      id: 'inbox-unassigned', labelKey: 'inbox.unassigned', icon: 'i-lucide-user-x', to: { path: '/inbox', query: { state: 'open', assignee: 'unassigned' } },
      capability: 'inbox.conversations.read', section: workSection,
      active: route => inWorkspace(route) && assigneeOf(route) === 'unassigned',
    },
    {
      id: 'inbox-mine', labelKey: 'inbox.kpi.mine', icon: 'i-lucide-user-round-check', to: { path: '/inbox', query: { state: 'open', assignee: 'me' } },
      capability: 'inbox.conversations.read', section: workSection,
      active: route => inWorkspace(route) && assigneeOf(route) === 'me',
    },
    {
      id: 'inbox-orders', labelKey: 'inbox.nav.orders', icon: 'i-lucide-shopping-cart', to: { path: '/inbox/orders' },
      capability: 'inbox.conversations.read', section: workSection,
      active: route => insidePath(route, '/inbox/orders'),
    },
    {
      id: 'inbox-campaigns', labelKey: 'inbox.nav.campaigns', icon: 'i-lucide-megaphone', to: { path: '/inbox/campaigns' },
      capability: 'inbox.campaigns.manage', section: outreachSection,
      active: route => insidePath(route, '/inbox/campaigns') && !inAudiences(route),
    },
    {
      id: 'inbox-audiences', labelKey: 'inbox.campaigns.audiences.title', icon: 'i-lucide-users-round', to: { path: '/inbox/campaigns/audiences' },
      capability: 'inbox.campaigns.manage', section: outreachSection,
      active: inAudiences,
    },
    {
      id: 'inbox-reports', labelKey: 'inbox.nav.reports', icon: 'i-lucide-chart-column', to: { path: '/inbox/reports' },
      capability: 'inbox.reports.read', section: insightSection,
      active: route => insidePath(route, '/inbox/reports'),
    },
  ],
  counts: [
    {
      capability: 'inbox.conversations.read',
      queryKey: inboxQueueCountsKey(queueFilters('unassigned'), queueFilters('me')),
      async load(api: AppSearchApi) {
        const count = (assignee: 'unassigned' | 'me') => api('/api/v1/inbox/conversations', { query: queueFilters(assignee), schema: InboxConversationListSchema })
        const [unassigned, mine] = await Promise.all([count('unassigned'), count('me')])
        return { 'inbox-unassigned': unassigned.total, 'inbox-mine': mine.total }
      },
    },
    {
      capability: 'inbox.campaigns.manage',
      feature: 'inbox.campaigns',
      queryKey: ['inbox', 'campaigns', 'sidebar'],
      async load(api: AppSearchApi) {
        const [campaigns, audiences] = await Promise.all([
          api('/api/v1/inbox/campaigns', { query: { limit: 1 }, schema: InboxCampaignListSchema }),
          api('/api/v1/inbox/audiences', { query: { limit: 1 }, schema: InboxAudienceListSchema }),
        ])
        return { 'inbox-campaigns': campaigns.total, 'inbox-audiences': audiences.total }
      },
    },
  ],
}
