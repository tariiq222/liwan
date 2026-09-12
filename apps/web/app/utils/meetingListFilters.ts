import type { LocationQueryRaw } from 'vue-router'
import { isCalendarDate } from '../composables/calendarDate'
import { parsePositiveId } from './routeParams'

export const MEETING_FILTER_KEYS = [
  'q',
  'state',
  'mine',
  'project_id',
  'organizer_id',
  'date_from',
  'date_to',
  'series_id',
] as const

export type MeetingFilterKey = typeof MEETING_FILTER_KEYS[number]
export type MeetingListQuery = Record<string, unknown>

export type MeetingListFilters = {
  q: string
  state: string
  mine: boolean
  projectId?: number
  organizerId?: number
  seriesId?: number
  dateFrom: string
  dateTo: string
}

export type MeetingDateRange = {
  fromValid: boolean
  toValid: boolean
  reversed: boolean
  invalid: boolean
}

function firstValue(value: unknown) {
  return Array.isArray(value) ? value[0] : value
}

export function meetingDateRange(dateFrom: string, dateTo: string): MeetingDateRange {
  const fromValid = !dateFrom || isCalendarDate(dateFrom)
  const toValid = !dateTo || isCalendarDate(dateTo)
  const reversed = fromValid && toValid && !!dateFrom && !!dateTo && dateFrom > dateTo
  return { fromValid, toValid, reversed, invalid: !fromValid || !toValid }
}

export function parseMeetingListFilters(query: MeetingListQuery): MeetingListFilters {
  const q = firstValue(query.q)
  const state = firstValue(query.state)
  const dateFrom = firstValue(query.date_from)
  const dateTo = firstValue(query.date_to)
  return {
    q: typeof q === 'string' ? q : '',
    state: typeof state === 'string' ? state : '',
    mine: firstValue(query.mine) === '1' || firstValue(query.mine) === 'true',
    projectId: parsePositiveId(query.project_id) ?? undefined,
    organizerId: parsePositiveId(query.organizer_id) ?? undefined,
    seriesId: parsePositiveId(query.series_id) ?? undefined,
    dateFrom: typeof dateFrom === 'string' ? dateFrom : '',
    dateTo: typeof dateTo === 'string' ? dateTo : '',
  }
}

export type MeetingFilterPatch = Partial<{
  q: string | undefined
  state: string | undefined
  mine: boolean
  project_id: number | undefined
  organizer_id: number | undefined
  date_from: string | undefined
  date_to: string | undefined
  series_id: number | undefined
  offset: number | undefined
}>

export function patchMeetingListQuery(query: MeetingListQuery, patch: MeetingFilterPatch): LocationQueryRaw {
  const next = { ...query } as LocationQueryRaw
  for (const [key, value] of Object.entries(patch)) {
    if (key === 'mine') next.mine = value ? '1' : undefined
    else next[key] = (value || undefined) as LocationQueryRaw[string]
  }
  const changedFilter = Object.keys(patch).some(key => MEETING_FILTER_KEYS.includes(key as MeetingFilterKey))
  if (changedFilter && !Object.hasOwn(patch, 'offset')) next.offset = undefined
  return next
}

export function clearMeetingListFilters(query: MeetingListQuery): LocationQueryRaw {
  const next = { ...query, offset: undefined } as LocationQueryRaw
  for (const key of MEETING_FILTER_KEYS) next[key] = undefined
  return next
}
