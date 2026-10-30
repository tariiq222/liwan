import { localIsoDay } from '@liwan/ui/app/utils/formatDate'
import type { KpiTile } from '@liwan/ui/app/utils/kpiTile'

type Scope = Record<string, string | number | boolean | undefined>
type Translate = (key: string) => string

/** The first and last day of the month that holds `today`. */
export function monthDayRange(today: Date): { from: string; to: string } {
  const first = new Date(today.getFullYear(), today.getMonth(), 1)
  const last = new Date(today.getFullYear(), today.getMonth() + 1, 0)
  return { from: localIsoDay(first), to: localIsoDay(last) }
}

/** The list filters of /meetings a tile adds on top of the page's own scope; each count is the `total` of a one-row request with them. */
export function meetingKpiFilters(today: Date) {
  const month = monthDayRange(today)
  return {
    total: {},
    upcoming: { state: 'confirmed', date_from: localIsoDay(today) },
    draft: { state: 'draft' },
    done: { state: 'done', date_from: month.from, date_to: month.to },
  } as const
}

/** A link to `path` with the given filters as its query; empty values are left out. */
export function kpiLink(path: string, filters: Scope): string {
  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(filters)) {
    if (value === undefined || value === false || value === '') continue
    query.set(key, value === true ? '1' : String(value))
  }
  const text = query.toString()
  return text ? `${path}?${text}` : path
}

/** The tiles above /meetings; a count that has not arrived yet is `null` and shows "—". */
export function meetingListTiles(counts: Record<keyof ReturnType<typeof meetingKpiFilters>, number | undefined>, links: Record<keyof ReturnType<typeof meetingKpiFilters>, string>, t: Translate): KpiTile[] {
  return [
    { id: 'total', label: t('meetingsKpi.total'), icon: 'i-lucide-calendar-days', tone: 'neutral', value: counts.total ?? null, to: links.total },
    { id: 'upcoming', label: t('meetingsKpi.upcoming'), icon: 'i-lucide-calendar-clock', tone: 'success', value: counts.upcoming ?? null, to: links.upcoming },
    { id: 'draft', label: t('meetingsKpi.draft'), icon: 'i-lucide-file-pen-line', tone: 'warning', value: counts.draft ?? null, to: links.draft },
    { id: 'done', label: t('meetingsKpi.doneMonth'), icon: 'i-lucide-circle-check', tone: 'neutral', value: counts.done ?? null, to: links.done },
  ]
}

/** The tiles above /meetings/series: the series total and the company-wide resolution counts (the series list has no aggregate of its own). */
export function meetingSeriesTiles(counts: { series?: number; open?: number; overdue?: number }, t: Translate): KpiTile[] {
  const scope = t('meetingsKpi.allMeetings')
  return [
    { id: 'series', label: t('meetingsKpi.series'), icon: 'i-lucide-repeat', tone: 'neutral', value: counts.series ?? null },
    { id: 'open', label: t('meetingsKpi.openResolutions'), icon: 'i-lucide-clock', tone: 'warning', value: counts.open ?? null, hint: scope, to: kpiLink('/meetings/follow-up', { state: 'active' }) },
    { id: 'overdue', label: t('meetingsKpi.overdueResolutions'), icon: 'i-lucide-circle-alert', tone: 'danger', value: counts.overdue ?? null, hint: scope, to: kpiLink('/meetings/follow-up', { state: 'overdue' }) },
  ]
}

export const followupKpiStates = ['all', 'active', 'overdue', 'done'] as const
export type FollowupKpiState = typeof followupKpiStates[number]

/** The tiles above /meetings/follow-up, counted under the page's search and "mine" scope (the state is each tile's own). */
export function meetingFollowupTiles(counts: Partial<Record<FollowupKpiState, number>>, scope: Scope, t: Translate): KpiTile[] {
  const link = (state: FollowupKpiState) => kpiLink('/meetings/follow-up', { ...scope, state })
  return [
    { id: 'all', label: t('meetingsKpi.followupTotal'), icon: 'i-lucide-list-checks', tone: 'neutral', value: counts.all ?? null, to: link('all') },
    { id: 'active', label: t('meetingsKpi.followupActive'), icon: 'i-lucide-clock', tone: 'warning', value: counts.active ?? null, to: link('active') },
    { id: 'overdue', label: t('meetingsKpi.followupOverdue'), icon: 'i-lucide-circle-alert', tone: 'danger', value: counts.overdue ?? null, to: link('overdue') },
    { id: 'done', label: t('meetingsKpi.followupDone'), icon: 'i-lucide-circle-check', tone: 'success', value: counts.done ?? null, to: link('done') },
  ]
}
