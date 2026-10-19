import { isCalendarDate } from '@webvue/ui/app/composables/calendarDate'
import { firstQuery } from './routeQuery'

export function meetingCreateRoute(returnTo: string, projectId?: number | string, seriesId?: number | string) {
  return {
    path: '/meetings/new',
    query: {
      ...(projectId !== undefined && projectId !== null && String(projectId) ? { project_id: String(projectId) } : {}),
      ...(seriesId !== undefined && seriesId !== null && String(seriesId) ? { series_id: String(seriesId) } : {}),
      returnTo,
    },
  }
}

/** The list and calendar share filters; only the calendar owns the fetched month. */
export function meetingViewRoute(query: Record<string, unknown>, view: 'list' | 'calendar', now = new Date()) {
  const next: Record<string, string> = {}
  for (const key of ['q', 'state', 'mine', 'project_id', 'organizer_id', 'series_id', 'date_from', 'date_to', 'year', 'month', 'day']) {
    const value = firstQuery(query[key])
    if (value) next[key] = value
  }
  const validMonth = Number.isInteger(Number(next.year)) && Number(next.year) >= 1970 && Number(next.year) <= 2100
    && Number.isInteger(Number(next.month)) && Number(next.month) >= 1 && Number(next.month) <= 12
  if (view === 'calendar') {
    if (!validMonth) {
      const anchor = next.date_from && isCalendarDate(next.date_from) ? next.date_from : null
      next.year = anchor ? anchor.slice(0, 4) : String(now.getFullYear())
      next.month = anchor ? String(Number(anchor.slice(5, 7))) : String(now.getMonth() + 1)
      delete next.day
    }
  } else if (validMonth && !next.date_from && !next.date_to) {
    const prefix = `${next.year}-${next.month!.padStart(2, '0')}`
    next.date_from = `${prefix}-01`
    next.date_to = `${prefix}-${new Date(Number(next.year), Number(next.month), 0).getDate()}`
  }
  return { path: view === 'calendar' ? '/meetings/calendar' : '/meetings', query: next }
}

export function meetingViewOptions(t: (key: string) => string) {
  return [
    { value: 'list', label: t('meetingsUx.listView'), icon: 'i-lucide-list', testId: 'meeting-view-list' },
    { value: 'calendar', label: t('nav.meetingCalendar'), icon: 'i-lucide-calendar-days', testId: 'meeting-view-calendar' },
  ]
}

/** Same-origin download of the current minutes; the backend answers with an attachment. */
export function meetingMinutesPdfPath(meetingId: number) {
  return `/api/v1/meetings/${meetingId}/minutes.pdf`
}
