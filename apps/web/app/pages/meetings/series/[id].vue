<script setup lang="ts">
import FilterBar from '@/components/shared/FilterBar.vue'
import MeetingEventList from '@/components/meetings/MeetingEventList.vue'
import MeetingTimeline from '@/components/meetings/MeetingTimeline.vue'
import { useMeetingSeries } from '@/composables/useMeetings'
import { useMeetingEvents, useMeetingSeriesResolutions } from '@/composables/useMeetingWorkspace'
import { formatCalendarDate, formatNasqTime } from '@/composables/calendarDate'
import { returnToQuery, safeReturnTo } from '@/utils/safeReturnTo'
import { isCalendarDate } from '@/utils/meetingListFilters'
import { meetingTimestamp, prioritizeTimelinePage, selectNextMeeting, selectPreviousMeeting } from '@/utils/meetingWorkspace'

type SeriesTab = 'sessions' | 'followup' | 'history' | 'details'
const tabs: SeriesTab[] = ['sessions', 'followup', 'history', 'details']

const hydrated = useHydrated()
const route = useRoute()
const router = useRouter()
const { t, locale } = useI18n()
const { can } = useAccess()
const { me } = useMe()
const id = computed(() => Number(route.params.id))
const isDetail = computed(() => route.path === `/meetings/series/${id.value}`)
const query = useMeetingSeries(computed(() => isDetail.value ? id.value : null))
const backTo = computed(() => safeReturnTo(route.query.returnTo, '/meetings/series', ['/meetings']))
const now = ref(new Date())
const headerDescription = computed(() => query.data.value ? `${query.data.value.organizer?.name || t('meetingTimeline.noOrganizer')} · ${t(`meetingsUi.recurrence.${query.data.value.recurrence}`)}` : undefined)

function routeValue(key: string) {
  const value = route.query[key]
  return Array.isArray(value) ? String(value[0] ?? '') : typeof value === 'string' ? value : ''
}
function parsePage(value: string, fallback = 0) {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback
}
function setQuery(patch: Record<string, string | undefined>) {
  void router.replace({ query: { ...route.query, ...patch } })
}

const activeTab = computed<SeriesTab>(() => tabs.includes(routeValue('tab') as SeriesTab) ? routeValue('tab') as SeriesTab : 'sessions')
const ALL_STATES = '__all__'
const sessionStateSelect = computed({ get: () => occurrenceState.value || ALL_STATES, set: value => { occurrenceState.value = value === ALL_STATES ? '' : String(value) } })
const followupStateSelect = computed({ get: () => followupState.value || ALL_STATES, set: value => { followupState.value = value === ALL_STATES ? '' : String(value) } })
const occurrenceSearch = computed({ get: () => routeValue('session_q'), set: value => setQuery({ session_q: value.trim() || undefined, session_limit: undefined }) })
const occurrenceState = computed({ get: () => routeValue('session_state'), set: value => setQuery({ session_state: value || undefined, session_limit: undefined }) })
const dateFrom = computed({ get: () => routeValue('session_from'), set: value => setQuery({ session_from: value || undefined, session_limit: undefined }) })
const dateTo = computed({ get: () => routeValue('session_to'), set: value => setQuery({ session_to: value || undefined, session_limit: undefined }) })
const dateFromField = computed({ get: () => dateFrom.value || null, set: value => { dateFrom.value = value || '' } })
const dateToField = computed({ get: () => dateTo.value || null, set: value => { dateTo.value = value || '' } })
const occurrenceSort = computed({ get: () => routeValue('session_sort') || 'timeline', set: value => setQuery({ session_sort: value === 'timeline' ? undefined : value }) })
const occurrenceView = computed<'timeline' | 'table'>({ get: () => routeValue('session_view') === 'table' ? 'table' : 'timeline', set: value => setQuery({ session_view: value === 'timeline' ? undefined : value }) })
const occurrenceLimit = computed(() => Math.max(25, parsePage(routeValue('session_limit'), 25)))
const validDateRange = computed(() => (!dateFrom.value || isCalendarDate(dateFrom.value)) && (!dateTo.value || isCalendarDate(dateTo.value)) && (!dateFrom.value || !dateTo.value || dateFrom.value <= dateTo.value))

function meetingSearchText(meeting: { name: string; reference: string; meeting_date: string | null; state: string }) {
  return [meeting.name, meeting.reference, meeting.meeting_date, meeting.state].join(' ').toLocaleLowerCase()
}

const filteredMeetings = computed(() => {
  const q = occurrenceSearch.value.trim().toLocaleLowerCase()
  const state = occurrenceState.value
  const rows = (query.data.value?.meetings ?? []).filter(meeting => {
    if (state && meeting.state !== state) return false
    if (q && !meetingSearchText(meeting).includes(q)) return false
    if (validDateRange.value && dateFrom.value && (!meeting.meeting_date || meeting.meeting_date < dateFrom.value)) return false
    if (validDateRange.value && dateTo.value && (!meeting.meeting_date || meeting.meeting_date > dateTo.value)) return false
    return true
  })
  return [...rows].sort((left, right) => {
    if (occurrenceSort.value === 'name') return left.name.localeCompare(right.name, locale.value) || left.id - right.id
    const leftTime = meetingTimestamp(left)
    const rightTime = meetingTimestamp(right)
    if (leftTime === null) return rightTime === null ? left.id - right.id : 1
    if (rightTime === null) return -1
    const order = leftTime - rightTime
    return (occurrenceSort.value === 'date_desc' ? -order : order) || left.id - right.id
  })
})
const visibleMeetings = computed(() => occurrenceSort.value === 'timeline'
  ? prioritizeTimelinePage(filteredMeetings.value, now.value, occurrenceLimit.value)
  : filteredMeetings.value.slice(0, occurrenceLimit.value))
const hasMoreMeetings = computed(() => visibleMeetings.value.length < filteredMeetings.value.length)
const activeSessionFilterCount = computed(() => [occurrenceSearch.value.trim(), occurrenceState.value, dateFrom.value, dateTo.value].filter(Boolean).length)
const upcoming = computed(() => selectNextMeeting(query.data.value?.meetings ?? [], now.value))
const previous = computed(() => selectPreviousMeeting(query.data.value?.meetings ?? [], now.value))

function setTab(value: unknown) {
  if (!tabs.includes(value as SeriesTab)) return
  const tab = value as SeriesTab
  if (!hydrated.value || tab === activeTab.value) return
  setQuery({ tab: tab === 'sessions' ? undefined : tab })
}
function clearSessionFilters() {
  setQuery({ session_q: undefined, session_state: undefined, session_from: undefined, session_to: undefined, session_sort: undefined, session_limit: undefined })
}
function loadMoreMeetings() {
  if (hasMoreMeetings.value) setQuery({ session_limit: String(occurrenceLimit.value + 25) })
}
function localTime(value: string | null) {
  if (!value) return '—'
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? '—' : formatNasqTime(parsed, locale.value)
}
function occurrenceLabel(meeting: { meeting_date: string | null; start_datetime: string | null }) {
  const date = meeting.meeting_date ? formatCalendarDate(meeting.meeting_date, locale.value) : t('meetingTimeline.unknownDate')
  return meeting.start_datetime ? `${date} · ${localTime(meeting.start_datetime)}` : date
}
const canAddOccurrence = computed(() => {
  const series = query.data.value
  const userId = me.value?.id
  return can('meetings.create') && (can('meetings.manage') || (userId !== undefined && (series?.organizer?.id === userId || series?.secretary?.id === userId)))
})

const followupSearch = computed({ get: () => routeValue('followup_q'), set: value => setQuery({ followup_q: value.trim() || undefined, followup_page: undefined }) })
const followupState = computed({ get: () => routeValue('followup_state'), set: value => setQuery({ followup_state: value || undefined, followup_page: undefined }) })
const followupPage = computed(() => parsePage(routeValue('followup_page')))
const followupPageSize = 25
const followupId = computed(() => isDetail.value && activeTab.value === 'followup' ? id.value : null)
const followupQuery = useMeetingSeriesResolutions(followupId, computed(() => ({ limit: followupPageSize, offset: followupPage.value * followupPageSize, q: followupSearch.value.trim() || undefined, state: followupState.value || undefined })))
const followupPages = computed(() => Math.max(1, Math.ceil((followupQuery.data.value?.total ?? 0) / followupPageSize)))
const followupPageNumber = computed(() => followupPage.value + 1)
const followupFilterCount = computed(() => [followupSearch.value.trim(), followupState.value].filter(Boolean).length)
function setFollowupPage(page: number) {
  if (page < 0 || page >= followupPages.value || followupQuery.isFetching.value) return
  setQuery({ followup_page: page ? String(page) : undefined })
}
function clearFollowupFilters() {
  setQuery({ followup_q: undefined, followup_state: undefined, followup_page: undefined })
}
function followupStateLabel(state: string) {
  if (state === 'active') return t('meetingTimeline.activeFollowup')
  if (state === 'overdue') return t('meetingTimeline.overdueFollowup')
  return t(`meetingsUi.resolutionState.${state}`)
}
function resolutionTaskId(item: unknown) {
  const value = item as { task_id?: number | null; task_linked?: boolean }
  return value.task_id || null
}
function resolutionText(item: unknown, key: 'deadline' | 'execution_period') {
  const value = item as Record<string, unknown>
  return typeof value[key] === 'string' ? value[key] as string : ''
}
function resolutionProject(item: unknown) {
  const project = (item as { project?: { id: number; name: string } | null }).project
  return project && Number.isInteger(project.id) ? project : null
}
function hasRichText(value: string | null | undefined) {
  return Boolean(value?.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim() || /<(img|table|video|iframe)\b/i.test(value || ''))
}

const historyPage = computed(() => parsePage(routeValue('history_page')))
const historyPageSize = 25
const historyId = computed(() => isDetail.value && activeTab.value === 'history' ? id.value : null)
const historyQuery = useMeetingEvents(historyId, computed(() => ({ limit: historyPageSize, offset: historyPage.value * historyPageSize })), true)
const historyPages = computed(() => Math.max(1, Math.ceil((historyQuery.data.value?.total ?? 0) / historyPageSize)))
const historyPageNumber = computed(() => historyPage.value + 1)
function setHistoryPage(page: number) {
  const next = page - 1
  if (next < 0 || next >= historyPages.value || historyQuery.isFetching.value) return
  setQuery({ history_page: next ? String(next) : undefined })
}
</script>

<template>
  <SharedPageContainer v-if="isDetail" width="detail">
    <SharedPageHeader :title="query.data.value?.name || t('nav.meetingSeries')" :description="headerDescription" :back-to="backTo">
      <template #actions>
        <UButton v-if="query.data.value?.can_edit === true" color="secondary" variant="outline" :to="{ path: `/meetings/series/${id}/edit`, query: { returnTo: route.fullPath } }" :label="t('meetingsUx.seriesSettingsLink')" />
        <UButton v-if="canAddOccurrence" :disabled="!hydrated" :to="{ path: '/meetings/new', query: { ...returnToQuery(route.fullPath), series_id: String(id) } }" :label="t('meetingsUi.addOccurrence')" />
      </template>
    </SharedPageHeader>
    <SharedPageState :loading="query.isLoading.value" :error="query.error.value" @retry="query.refetch">
      <template v-if="query.data.value">
        <nav class="flex flex-wrap gap-2" :aria-label="t('meetingTimeline.sections')">
          <UButton v-for="tab in tabs" :key="tab" type="button" size="sm" :color="activeTab === tab ? 'primary' : 'secondary'" :variant="activeTab === tab ? 'solid' : 'outline'" :disabled="!hydrated" :label="t(`meetingTimeline.tabs.${tab}`)" @click="setTab(tab)" />
        </nav>

        <section v-if="activeTab === 'sessions'" class="grid gap-4" data-testid="meeting-series-sessions">
          <UCard class="grid gap-2">
            <div class="flex flex-wrap items-start justify-between gap-3"><div><h2 class="text-lg font-semibold text-highlighted">{{ t('meetingTimeline.scheduleSummary') }}</h2><p class="mt-1 text-sm text-muted">{{ t('meetingTimeline.scheduleSummaryHint') }}</p></div><div class="flex items-center gap-2 text-sm"><UButton type="button" size="sm" :color="occurrenceView === 'timeline' ? 'primary' : 'secondary'" :variant="occurrenceView === 'timeline' ? 'solid' : 'outline'" :disabled="!hydrated" :label="t('meetingTimeline.timelineView')" @click="occurrenceView = 'timeline'" /><UButton type="button" size="sm" :color="occurrenceView === 'table' ? 'primary' : 'secondary'" :variant="occurrenceView === 'table' ? 'solid' : 'outline'" :disabled="!hydrated" :label="t('meetingTimeline.tableView')" @click="occurrenceView = 'table'" /></div></div>
            <div class="flex flex-wrap gap-2"><NuxtLink :to="{ query: { ...route.query, tab: 'followup', followup_state: 'active', followup_page: undefined } }" class="rounded-lg border border-border bg-brand-soft/50 px-3 py-2 text-sm text-brand-link underline-offset-4 hover:underline">{{ t('meetingsUi.openCount', { count: query.data.value.open_resolution_count }) }}</NuxtLink><NuxtLink :to="{ query: { ...route.query, tab: 'followup', followup_state: 'overdue', followup_page: undefined } }" class="rounded-lg border border-border bg-brand-soft/50 px-3 py-2 text-sm text-brand-link underline-offset-4 hover:underline">{{ t('meetingsUi.overdueCount', { count: query.data.value.overdue_resolution_count }) }}</NuxtLink></div>
            <div class="w-full min-w-0 grid gap-3 sm:grid-cols-2"><div class="rounded-lg border border-border/70 p-3"><p class="text-xs text-muted-foreground">{{ t('meetingsUi.nextMeeting') }}</p><p v-if="upcoming" class="mt-1 font-medium"><NuxtLink :to="{ path: `/meetings/${upcoming.id}`, query: returnToQuery(route.fullPath) }" class="text-brand-link underline-offset-4 hover:underline">{{ upcoming.name }}</NuxtLink><span class="mt-1 block text-sm text-muted-foreground">{{ occurrenceLabel(upcoming) }}</span></p><p v-else class="mt-1 text-sm text-muted-foreground">{{ t('meetingsUx.noNextMeeting') }}</p></div><div class="rounded-lg border border-border/70 p-3"><p class="text-xs text-muted-foreground">{{ t('meetingTimeline.lastCompleted') }}</p><p v-if="previous" class="mt-1 font-medium"><NuxtLink :to="{ path: `/meetings/${previous.id}`, query: returnToQuery(route.fullPath) }" class="text-brand-link underline-offset-4 hover:underline">{{ previous.name }}</NuxtLink><span class="mt-1 block text-sm text-muted-foreground">{{ occurrenceLabel(previous) }}</span></p><p v-else class="mt-1 text-sm text-muted-foreground">{{ t('meetingTimeline.noCompletedMeeting') }}</p></div></div>
          </UCard>
          <FilterBar :title="t('filterCard.title')" :active-count="activeSessionFilterCount" :clear-label="t('meetingsUi.clear')" :disabled="!hydrated" @clear="clearSessionFilters">
            <div class="w-full min-w-0 grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><UFormField class="sm:col-span-2" :label="t('meetingTimeline.searchSessions')" name="sessionSearch"><UInput id="series-session-search" v-model="occurrenceSearch" class="w-full" :disabled="!hydrated" :placeholder="t('meetingTimeline.searchSessions')" /></UFormField><UFormField :label="t('meetingsUi.stateLabel')" name="sessionState"><USelect id="series-session-state" v-model="sessionStateSelect" class="w-full" :disabled="!hydrated" :items="[{ label: t('meetingsUi.allStates'), value: ALL_STATES }, ...['draft', 'confirmed', 'done', 'cancelled'].map(state => ({ label: t(`meetingsUi.state.${state}`), value: state }))]" /></UFormField><UFormField :label="t('meetingTimeline.sort')" name="sessionSort"><USelect id="series-session-sort" v-model="occurrenceSort" class="w-full" :disabled="!hydrated" :items="[{ label: t('meetingTimeline.sortTimeline'), value: 'timeline' }, { label: t('meetingTimeline.sortNewest'), value: 'date_desc' }, { label: t('meetingTimeline.sortOldest'), value: 'date_asc' }, { label: t('meetingTimeline.sortName'), value: 'name' }]" /></UFormField><UFormField :label="t('meetingTimeline.from')" name="sessionFrom"><SharedDateField id="series-session-from" v-model="dateFromField" class="w-full" :disabled="!hydrated" :aria-invalid="!validDateRange" /></UFormField><UFormField :label="t('meetingTimeline.to')" name="sessionTo"><SharedDateField id="series-session-to" v-model="dateToField" class="w-full" :disabled="!hydrated" :aria-invalid="!validDateRange" /></UFormField></div>
            <UAlert v-if="!validDateRange" role="alert" color="error" variant="subtle" class="mt-2" :title="t('meetingTimeline.invalidDateRange')" />
            <template #active><div class="flex flex-wrap items-center gap-2"><UBadge v-if="occurrenceSearch.trim()" color="neutral" variant="subtle">{{ occurrenceSearch }}</UBadge><UBadge v-if="occurrenceState" color="neutral" variant="subtle">{{ t(`meetingsUi.state.${occurrenceState}`) }}</UBadge><UBadge v-if="dateFrom" color="neutral" variant="subtle">{{ dateFrom }}</UBadge><UBadge v-if="dateTo" color="neutral" variant="subtle">{{ dateTo }}</UBadge></div></template>
          </FilterBar>
          <UCard class="overflow-hidden"><MeetingTimeline :meetings="visibleMeetings" :next-meeting-id="upcoming?.id" :view="occurrenceView" :preserve-order="occurrenceSort !== 'timeline'" :return-to="route.fullPath" :now="now" /></UCard>
          <div v-if="hasMoreMeetings" class="flex justify-center"><UButton color="secondary" variant="outline" :disabled="!hydrated" :label="t('meetingTimeline.loadMore')" @click="loadMoreMeetings" /></div>
        </section>

        <section v-else-if="activeTab === 'followup'" class="grid gap-4" data-testid="meeting-series-followup">
          <FilterBar :title="t('meetingTimeline.followupTitle')" :active-count="followupFilterCount" :clear-label="t('meetingsUi.clear')" :disabled="!hydrated" @clear="clearFollowupFilters"><div class="w-full min-w-0 grid gap-3 sm:grid-cols-2"><UFormField :label="t('meetingTimeline.searchFollowup')" name="followupSearch"><UInput id="series-followup-search" v-model="followupSearch" class="w-full" :disabled="!hydrated" :placeholder="t('meetingTimeline.searchFollowup')" /></UFormField><UFormField :label="t('meetingsUi.stateLabel')" name="followupState"><USelect id="series-followup-state" v-model="followupStateSelect" class="w-full" :disabled="!hydrated" :items="[{ label: t('meetingsUi.allStates'), value: ALL_STATES }, ...['active', 'overdue', 'open', 'in_progress', 'done', 'cancelled'].map(state => ({ label: followupStateLabel(state), value: state }))]" /></UFormField></div><template #active><div class="flex flex-wrap items-center gap-2"><UBadge v-if="followupSearch.trim()" color="neutral" variant="subtle">{{ followupSearch }}</UBadge><UBadge v-if="followupState" color="neutral" variant="subtle">{{ followupStateLabel(followupState) }}</UBadge></div></template></FilterBar>
          <SharedPageState :loading="followupQuery.isLoading.value" :error="followupQuery.error.value" :empty="!followupQuery.isLoading.value && !followupQuery.data.value?.items.length" :empty-text="t('meetingTimeline.noFollowup')" @retry="followupQuery.refetch"><UCard class="divide-y divide-default"><article v-for="item in followupQuery.data.value?.items" :key="`${item.meeting_id}-${item.id}`" class="grid gap-2 p-4"><div class="flex flex-wrap items-start justify-between gap-2"><div class="min-w-0"><NuxtLink :to="{ path: `/meetings/${item.meeting_id}`, query: { ...returnToQuery(route.fullPath), tab: 'resolutions' } }" class="font-medium text-brand-link underline-offset-4 hover:underline">{{ item.name }}</NuxtLink><p class="text-xs text-muted">{{ item.meeting_name }}</p></div><UBadge color="neutral" variant="outline">{{ followupStateLabel(item.execution_state || item.state) }}</UBadge></div><div class="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted"><span v-if="resolutionText(item, 'deadline')">{{ t('meetingsUi.deadline') }}: {{ resolutionText(item, 'deadline') }}</span><span v-if="resolutionText(item, 'execution_period')">{{ t('meetingTimeline.executionPeriod') }}: {{ resolutionText(item, 'execution_period') }}</span><NuxtLink v-if="resolutionProject(item)" :to="{ path: `/projects/${resolutionProject(item)?.id}`, query: returnToQuery(route.fullPath) }" class="text-brand-link underline-offset-4 hover:underline">{{ t('meetingsUi.project') }}: {{ resolutionProject(item)?.name }}</NuxtLink></div><p v-if="item.responsible" class="text-sm text-muted">{{ t('meetingsUi.responsible') }}: {{ item.responsible.name }}</p><p v-if="item.result && !hasRichText(item.result)" class="whitespace-pre-wrap text-sm">{{ item.result }}</p><div v-else-if="item.result" class="meeting-rich-text text-sm" v-html="item.result" /><NuxtLink v-if="resolutionTaskId(item)" :to="{ path: `/tasks/${resolutionTaskId(item)}`, query: returnToQuery(route.fullPath) }" class="text-sm text-brand-link underline-offset-4 hover:underline">{{ t('meetingsUi.openTask') }}</NuxtLink></article></UCard></SharedPageState>
          <nav v-if="followupPages > 1" class="flex items-center justify-between text-sm text-muted" :aria-label="t('meetingTimeline.followupTitle')"><UButton color="neutral" variant="ghost" :disabled="!hydrated || followupPage === 0" :label="t('projects.previousPage')" @click="setFollowupPage(followupPage - 1)" /><span>{{ t('meetingsUi.pageOf', { page: followupPageNumber, pages: followupPages }) }}</span><UButton color="neutral" variant="ghost" :disabled="!hydrated || followupPageNumber >= followupPages" :label="t('projects.nextPage')" @click="setFollowupPage(followupPage + 1)" /></nav>
        </section>

        <section v-else-if="activeTab === 'history'" class="grid gap-4" data-testid="meeting-series-history"><UCard><h2 class="text-lg font-semibold text-highlighted">{{ t('meetingTimeline.historyTitle') }}</h2><p class="mt-1 text-sm text-muted">{{ t('meetingTimeline.historyHint') }}</p></UCard><MeetingEventList :events="historyQuery.data.value?.items ?? []" :loading="historyQuery.isLoading.value" :error="historyQuery.error.value" :total="historyQuery.data.value?.total ?? 0" :page="historyPageNumber" :page-size="historyPageSize" @retry="historyQuery.refetch" @page="setHistoryPage" /></section>

        <section v-else class="grid gap-4" data-testid="meeting-series-details"><UCard><template #header><h2 class="text-lg font-semibold text-highlighted">{{ t('meetingsUi.series') }}</h2></template><dl class="grid gap-4 sm:grid-cols-2"><div><dt class="text-sm text-muted">{{ t('meetingsUi.organizer') }}</dt><dd>{{ query.data.value.organizer?.name || '—' }}</dd></div><div><dt class="text-sm text-muted">{{ t('meetingsUi.recurrenceLabel') }}</dt><dd>{{ t(`meetingsUi.recurrence.${query.data.value.recurrence}`) }}</dd></div><div><dt class="text-sm text-muted">{{ t('meetingsUi.project') }}</dt><dd>{{ query.data.value.project?.name || '—' }}</dd></div><div><dt class="text-sm text-muted">{{ t('meetingsUi.secretary') }}</dt><dd>{{ query.data.value.secretary?.name || '—' }}</dd></div><div><dt class="text-sm text-muted">{{ t('meetingsUi.location') }}</dt><dd>{{ query.data.value.location || '—' }}</dd></div><div v-if="query.data.value.meeting_url"><dt class="text-sm text-muted">{{ t('meetingsUi.url') }}</dt><dd><a :href="query.data.value.meeting_url" target="_blank" rel="noopener" class="break-all text-brand-link underline" dir="ltr">{{ query.data.value.meeting_url }}</a></dd></div><div><dt class="text-sm text-muted">{{ t('meetingsUx.attendees') }}</dt><dd>{{ query.data.value.attendees.map(person => person.name).join('، ') || '—' }}</dd></div><div><dt class="text-sm text-muted">{{ t('meetingsUx.termination') }}</dt><dd>{{ query.data.value.until_count ? t('meetingsUx.terminationCount', { count: query.data.value.until_count }) : query.data.value.until_date ? formatCalendarDate(query.data.value.until_date, locale) : t('meetingsUx.terminationOpen') }}</dd></div><div><dt class="text-sm text-muted">{{ t('meetingsUi.openCount', { count: query.data.value.open_resolution_count }) }}</dt><dd>{{ t('meetingsUi.overdueCount', { count: query.data.value.overdue_resolution_count }) }}</dd></div></dl></UCard></section>
      </template>
    </SharedPageState>
  </SharedPageContainer>
  <NuxtPage v-else />
</template>
