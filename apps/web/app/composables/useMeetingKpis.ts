import type { MaybeRefOrGetter } from 'vue'
import { computed, toValue } from 'vue'
import { followupKpiStates, meetingFollowupTiles, meetingKpiFilters, meetingListTiles, meetingSeriesTiles, kpiLink, type FollowupKpiState } from '@/utils/meetingKpis'
import { useMeetingFollowup, type MeetingFollowupParams } from './useMeetingWorkspace'
import { useMeetings, useMeetingSeriesList } from './useMeetings'

type MeetingScope = { q?: string; mine?: boolean; project_id?: number; organizer_id?: number; series_id?: number }

// Every count is the `total` of the page's own list API asked for one row with the tile's filter, never a sum over the
// loaded page. The queries live under the meetings and meeting-series key roots, so every meeting write refreshes them.

/** The four tiles of /meetings under the page's scope filters (search, mine, project, organizer, series); each tile adds its own state and dates. */
export function useMeetingListKpis(scope: MaybeRefOrGetter<MeetingScope>) {
  const today = new Date()
  const { t } = useI18n()
  const filters = meetingKpiFilters(today)
  const queries = {
    total: useMeetings(() => ({ ...toValue(scope), ...filters.total, limit: 1 })),
    upcoming: useMeetings(() => ({ ...toValue(scope), ...filters.upcoming, limit: 1 })),
    draft: useMeetings(() => ({ ...toValue(scope), ...filters.draft, limit: 1 })),
    done: useMeetings(() => ({ ...toValue(scope), ...filters.done, limit: 1 })),
  }
  const links = computed(() => {
    const { q, mine, project_id, organizer_id, series_id } = toValue(scope)
    const base = { q, mine, project_id, organizer_id, series_id }
    return {
      total: kpiLink('/meetings', base),
      upcoming: kpiLink('/meetings', { ...base, ...filters.upcoming }),
      draft: kpiLink('/meetings', { ...base, ...filters.draft }),
      done: kpiLink('/meetings', { ...base, ...filters.done }),
    }
  })
  const tiles = computed(() => meetingListTiles({
    total: queries.total.data.value?.total,
    upcoming: queries.upcoming.data.value?.total,
    draft: queries.draft.data.value?.total,
    done: queries.done.data.value?.total,
  }, links.value, t))
  const loading = computed(() => Object.values(queries).some(query => query.isLoading.value))
  return { tiles, loading }
}

/** The tiles of /meetings/series: the series total and the company-wide open and overdue resolution totals (the series list has no filter for them). */
export function useMeetingSeriesKpis() {
  const { t } = useI18n()
  const series = useMeetingSeriesList({ limit: 1 })
  const open = useMeetingFollowup({ state: 'active', limit: 1 })
  const overdue = useMeetingFollowup({ state: 'overdue', limit: 1 })
  const tiles = computed(() => meetingSeriesTiles({
    series: series.data.value?.total,
    open: open.data.value?.total,
    overdue: overdue.data.value?.total,
  }, t))
  const loading = computed(() => [series, open, overdue].some(query => query.isLoading.value))
  return { tiles, loading }
}

/** The tiles of /meetings/follow-up: total, active, overdue and done recommendations under the page's search and "mine" scope. */
export function useMeetingFollowupKpis(scope: MaybeRefOrGetter<{ q?: string; mine?: boolean }>) {
  const { t } = useI18n()
  const countFor = (state: FollowupKpiState) => useMeetingFollowup(() => ({ ...toValue(scope), state: state === 'all' ? undefined : state, limit: 1 } satisfies MeetingFollowupParams))
  const queries = Object.fromEntries(followupKpiStates.map(state => [state, countFor(state)])) as Record<FollowupKpiState, ReturnType<typeof countFor>>
  const tiles = computed(() => {
    const { q, mine } = toValue(scope)
    const counts = Object.fromEntries(followupKpiStates.map(state => [state, queries[state].data.value?.total])) as Partial<Record<FollowupKpiState, number>>
    return meetingFollowupTiles(counts, { q, mine }, t)
  })
  const loading = computed(() => Object.values(queries).some(query => query.isLoading.value))
  return { tiles, loading }
}
