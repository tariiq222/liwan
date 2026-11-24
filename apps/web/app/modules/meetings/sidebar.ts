import { MeetingFollowupListSchema, MeetingListSchema, MeetingSeriesListSchema } from '@liwan/contracts'
import { normalizedPath } from '../../utils/routePath'
import type { AppSearchApi, AppSidebarMenu, AppSidebarRoute } from '../types'

const onPath = (route: AppSidebarRoute, path: string) => normalizedPath(route.path) === path
const insidePath = (route: AppSidebarRoute, path: string) => onPath(route, path) || normalizedPath(route.path).startsWith(`${path}/`)

const listSection = { id: 'meetings-list', titleKey: 'meetingsUi.sidebarList' } as const
const organizationSection = { id: 'meetings-organization', titleKey: 'meetingsUi.sidebarOrganization' } as const

/**
 * The meetings sidebar: one flat level matching the projects sidebar pattern, with live server counts for
 * meetings, active follow-up recommendations, and recurring series, plus recently opened meetings.
 */
export const meetingsSidebar: AppSidebarMenu = {
  create: 'new-meeting',
  rows: [
    {
      id: 'meetings', labelKey: 'nav.meetings', icon: 'i-lucide-calendar-days', to: { path: '/meetings' },
      capability: 'meetings.read', section: listSection,
      active: route => onPath(route, '/meetings') || onPath(route, '/meetings/new'),
    },
    {
      id: 'meeting-calendar', labelKey: 'nav.meetingCalendar', icon: 'i-lucide-calendar-range', to: { path: '/meetings/calendar' },
      capability: 'meetings.read', section: listSection,
      active: route => onPath(route, '/meetings/calendar'),
    },
    {
      id: 'meeting-followup', labelKey: 'nav.meetingFollowup', icon: 'i-lucide-list-checks', to: { path: '/meetings/follow-up' },
      capability: 'meetings.read', section: listSection,
      active: route => onPath(route, '/meetings/follow-up'),
    },
    {
      id: 'meeting-series', labelKey: 'nav.meetingSeriesShort', icon: 'i-lucide-repeat', to: { path: '/meetings/series' },
      capability: 'meetings.read', section: organizationSection,
      active: route => insidePath(route, '/meetings/series'),
    },
  ],
  counts: [
    {
      capability: 'meetings.read',
      queryKey: ['meetings', 'sidebar', 'counts'],
      async load(api: AppSearchApi) {
        const [all, followup, series] = await Promise.all([
          api('/api/v1/meetings', { query: { limit: 1 }, schema: MeetingListSchema }),
          api('/api/v1/meetings/resolutions', { query: { state: 'active', limit: 1 }, schema: MeetingFollowupListSchema }),
          api('/api/v1/meeting-series', { query: { limit: 1 }, schema: MeetingSeriesListSchema }),
        ])
        return {
          meetings: all.total,
          'meeting-followup': followup.total,
          'meeting-series': series.total,
        }
      },
    },
  ],
  recent: { kind: 'meeting', titleKey: 'nav.recentMeetings', icon: 'i-lucide-calendar-days', capability: 'meetings.read', to: id => `/meetings/${id}` },
}
