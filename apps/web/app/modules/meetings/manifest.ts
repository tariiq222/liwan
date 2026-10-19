import { MeetingNotificationSchema } from '@webvue/contracts'
import type { AppManifest } from '../types'

const manifest: AppManifest = {
  id: 'meetings',
  feature: 'meetings.enabled',
  routePrefixes: ['/meetings'],
  recordListSources: [{ pattern: /^\/meetings\/series\/[1-9]\d*$/, capability: 'meetings.read' }],
  rail: [{ id: 'meetings', labelKey: 'nav.meetings', icon: 'i-lucide-calendar-days', to: '/meetings', order: 30 }],
  nav: [
    { to: '/meetings', labelKey: 'nav.meetings', icon: 'i-lucide-calendar-days', shortcut: 'm', goKey: 'm', capability: 'meetings.read' },
    { to: '/meetings/follow-up', labelKey: 'nav.meetingFollowup', icon: 'i-lucide-list-checks', shortcut: 'f', capability: 'meetings.read' },
    { to: '/meetings/calendar', labelKey: 'nav.meetingCalendar', icon: 'i-lucide-calendar-days', shortcut: 'l', capability: 'meetings.read' },
    { to: '/meetings/series', labelKey: 'nav.meetingSeries', icon: 'i-lucide-repeat', shortcut: 'y', capability: 'meetings.read' },
  ],
  contextLinks: () => [
    { id: 'new-meeting', labelKey: 'nav.newMeeting', icon: 'i-lucide-plus', to: '/meetings/new', capability: 'meetings.create', pinned: true },
    { id: 'meetings', labelKey: 'nav.meetings', icon: 'i-lucide-calendar-days', to: '/meetings', capability: 'meetings.read' },
    { id: 'meeting-followup', labelKey: 'nav.meetingFollowup', icon: 'i-lucide-list-checks', to: '/meetings/follow-up', capability: 'meetings.read' },
    { id: 'meeting-series', labelKey: 'nav.meetingSeriesShort', icon: 'i-lucide-repeat', to: '/meetings/series', capability: 'meetings.read' },
  ],
  landing: [
    { path: '/meetings', capability: 'meetings.read' },
    { path: '/meetings/calendar', capability: 'meetings.read' },
    { path: '/meetings/series', capability: 'meetings.read' },
  ],
  commands: [
    { id: 'meetings.new-meeting', labelKey: 'nav.newMeeting', icon: 'i-lucide-calendar-days', to: '/meetings/new', capability: 'meetings.create' },
    { id: 'meetings.new-series', labelKey: 'meetingsUi.newSeries', icon: 'i-lucide-repeat', to: '/meetings/series/new', capability: 'meetings.create' },
  ],
  routeCapabilities: [
    { pattern: /^\/meetings\/new$/, capability: 'meetings.create' },
    { pattern: /^\/meetings\/series\/new$/, capability: 'meetings.create' },
    { pattern: /^\/meetings\/[^/]+\/(edit|resolutions\/new)$/, capability: 'meetings.read' },
  ],
  bell: {
    capabilities: ['meetings.read'],
    kinds: MeetingNotificationSchema.shape.kind.options.map(kind => ({
      kind,
      href: (row: Record<string, unknown>) => `/meetings/${row.meeting_id}`,
      title: (row: Record<string, unknown>) => String(row.meeting_name),
    })),
  },
  isNavActive(path, target) {
    if (target === '/meetings') {
      if (path === '/meetings/follow-up' || path === '/meetings/new' || path.startsWith('/meetings/series')) return false
      return undefined
    }
    if (target === '/meetings/follow-up') return path === '/meetings/follow-up'
    if (target === '/meetings/calendar') return path === '/meetings/calendar'
    if (target === '/meetings/series') return path === '/meetings/series' || path.startsWith('/meetings/series/')
    return undefined
  },
}
export default manifest
