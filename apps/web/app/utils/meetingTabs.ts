import type { LocationQueryRaw } from 'vue-router'

export const MEETING_TAB_VALUES = ['summary', 'agenda', 'minutes', 'resolutions', 'attachments'] as const

export type MeetingTab = typeof MEETING_TAB_VALUES[number]

const LEGACY_MEETING_HASHES: Record<string, MeetingTab> = {
  '#meeting-summary': 'summary',
  '#meeting-agenda': 'agenda',
  '#meeting-minutes': 'minutes',
  '#meeting-resolutions': 'resolutions',
  '#meeting-attachments': 'attachments',
  '#meeting-snapshot': 'minutes',
}

export function isMeetingTab(value: unknown): value is MeetingTab {
  return typeof value === 'string' && (MEETING_TAB_VALUES as readonly string[]).includes(value)
}

export function meetingTabFromRoute(queryTab: unknown, hash: unknown): MeetingTab {
  if (isMeetingTab(queryTab)) return queryTab
  if (typeof hash === 'string' && LEGACY_MEETING_HASHES[hash]) return LEGACY_MEETING_HASHES[hash]
  return 'summary'
}

export function meetingTabQuery(query: LocationQueryRaw, tab: MeetingTab): LocationQueryRaw {
  return { ...query, tab }
}
