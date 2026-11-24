import { MeetingFollowupListSchema, MeetingListSchema } from '@liwan/contracts'
import { normalizedPath } from '../../utils/routePath'
import type { AppSearchApi, AppSidebarMenu, AppSidebarRoute } from '../types'

const onPath = (route: AppSidebarRoute, path: string) => normalizedPath(route.path) === path
const insidePath = (route: AppSidebarRoute, path: string) => onPath(route, path) || normalizedPath(route.path).startsWith(`${path}/`)
const isMine = (route: AppSidebarRoute) => onPath(route, '/meetings') && (route.query.mine === '1' || route.query.mine === 'true')

/**
 * The meetings sidebar: one flat level matching the projects sidebar pattern, with live server counts for
 * all meetings, my meetings, and active follow-up resolutions.
 */
export const meetingsSidebar: AppSidebarMenu = {
  create: 'new-meeting',
  rows: [
    {
      id: 'meetings', labelKey: 'nav.meetings', icon: 'i-lucide-calendar-days', to: { path: '/meetings' },
      capability: 'meetings.read',
      active: route => (onPath(route, '/meetings') || onPath(route, '/meetings/new')) && !isMine(route),
    },
    {
      id: 'my-meetings', labelKey: 'meetingsUi.mine', icon: 'i-lucide-user', to: { path: '/meetings', query: { mine: '1' } },
      capability: 'meetings.read',
      active: isMine,
    },
    {
      id: 'meeting-followup', labelKey: 'nav.meetingFollowup', icon: 'i-lucide-list-checks', to: { path: '/meetings/follow-up' },
      capability: 'meetings.read',
      active: route => onPath(route, '/meetings/follow-up'),
    },
    {
      id: 'meeting-calendar', labelKey: 'nav.meetingCalendar', icon: 'i-lucide-calendar-range', to: { path: '/meetings/calendar' },
      capability: 'meetings.read',
      active: route => onPath(route, '/meetings/calendar'),
    },
    {
      id: 'meeting-series', labelKey: 'nav.meetingSeriesShort', icon: 'i-lucide-repeat', to: { path: '/meetings/series' },
      capability: 'meetings.read',
      active: route => insidePath(route, '/meetings/series'),
    },
  ],
  counts: [
    {
      capability: 'meetings.read',
      queryKey: ['meetings', 'sidebar', 'counts'],
      async load(api: AppSearchApi) {
        const [all, mine, followup] = await Promise.all([
          api('/api/v1/meetings', { query: { limit: 1 }, schema: MeetingListSchema }),
          api('/api/v1/meetings', { query: { mine: 1, limit: 1 }, schema: MeetingListSchema }),
          api('/api/v1/meetings/resolutions', { query: { state: 'active', limit: 1 }, schema: MeetingFollowupListSchema }),
        ])
        return {
          meetings: all.total,
          'my-meetings': mine.total,
          'meeting-followup': followup.total,
        }
      },
    },
  ],
}
