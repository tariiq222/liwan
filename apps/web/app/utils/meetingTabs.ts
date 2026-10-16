import type { LocationQueryRaw } from 'vue-router'

const MEETING_TAB_VALUES = ['summary', 'agenda', 'minutes', 'resolutions', 'attachments', 'history', 'versions'] as const

export type MeetingTab = typeof MEETING_TAB_VALUES[number]

const LEGACY_MEETING_HASHES: Record<string, MeetingTab> = {
  '#meeting-summary': 'summary',
  '#meeting-agenda': 'agenda',
  '#meeting-minutes': 'minutes',
  '#meeting-resolutions': 'resolutions',
  '#meeting-attachments': 'attachments',
  '#meeting-snapshot': 'minutes',
  '#meeting-history': 'history',
  '#meeting-versions': 'versions',
}

export function isMeetingTab(value: unknown): value is MeetingTab {
  return typeof value === 'string' && (MEETING_TAB_VALUES as readonly string[]).includes(value)
}

export function meetingTabFromRoute(queryTab: unknown, hash: unknown): MeetingTab {
  if (queryTab === 'agenda') return 'summary'
  if (queryTab === 'versions') return 'history'
  if (isMeetingTab(queryTab)) return queryTab
  if (typeof hash === 'string' && LEGACY_MEETING_HASHES[hash]) return meetingTabFromRoute(LEGACY_MEETING_HASHES[hash], undefined)
  return 'summary'
}

export function meetingTabQuery(query: LocationQueryRaw, tab: MeetingTab): LocationQueryRaw {
  return { ...query, tab }
}

export function meetingHistoryViewFromRoute(tab: unknown, hash: unknown, view: unknown): 'events' | 'versions' {
  return tab === 'versions' || hash === '#meeting-versions' || view === 'versions' ? 'versions' : 'events'
}
