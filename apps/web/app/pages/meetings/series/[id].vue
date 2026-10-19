<script setup lang="ts">
import { owningListBack, recordChildTo } from '@/utils/recordListOrigin'
import { returnToQuery } from '@webvue/ui/app/utils/safeReturnTo'
import { SERIES_LIST_PATHS } from '@/modules/meetings/navigation'
import FilterBar from '@webvue/ui/app/components/shared/data/FilterBar.vue'
import MeetingEventList from '@/components/meetings/MeetingEventList.vue'
import MeetingTimeline from '@/components/meetings/MeetingTimeline.vue'
import { useAddSeriesOccurrence, useMeetingSeries } from '@/composables/useMeetings'
import { useMeetingFormFeedback } from '@/composables/useMeetingFormFeedback'
import { useMeetingSubmitError } from '@/composables/useMeetingSubmitError'
import { buildOccurrencePayload, occurrenceFormErrors } from '@/utils/meetingOccurrence'
import { useMeetingEvents, useMeetingSeriesResolutions } from '@/composables/useMeetingWorkspace'
import { formatCalendarDate, formatWebVueTime } from '@webvue/ui/app/composables/calendarDate'
import { isCalendarDate } from '@webvue/ui/app/composables/calendarDate'
import { meetingTimestamp, prioritizeTimelinePage, selectNextMeeting, selectPreviousMeeting } from '@/utils/meetingWorkspace'
import { resolutionStateBadgeProps } from '@/utils/meetingStatus'
import { richTextHasContent } from '@/utils/richText'
import { firstQuery } from '@/utils/routeQuery'
import { parsePositiveId } from '@/utils/routeParams'
import { ApiError } from '@/composables/useApi'

type SeriesTab = 'sessions' | 'followup' | 'history' | 'details'
const tabs: SeriesTab[] = ['sessions', 'followup', 'history', 'details']

const hydrated = useHydrated()
const route = useRoute()
const sourcePaths = useRecordListPaths(SERIES_LIST_PATHS)
const router = useRouter()
const { t, locale } = useI18n()
const { can } = useAccess()
const { me } = useMe()
const id = computed(() => parsePositiveId(route.params.id))
// This page is also the parent of `[id]/edit`: only the bare record path is the detail view.
const isDetail = computed(() => route.path === `/meetings/series/${route.params.id}`)
const query = useMeetingSeries(computed(() => isDetail.value ? id.value : null))
// An id that is not a canonical positive integer has no record to load and shows the same not-found state as an unknown id.
const pageError = computed(() => query.error.value ?? (id.value !== null ? null : new ApiError(404, 'not_found', t('errors.generic'))))
const backTo = computed(() => owningListBack(route.query, sourcePaths.value, route.hash))
const now = ref(new Date())
const headerDescription = computed(() => query.data.value ? `${query.data.value.organizer?.name || t('meetingTimeline.noOrganizer')} · ${t(`meetingsUi.recurrence.${query.data.value.recurrence}`)}` : undefined)

function routeValue(key: string) {
  return firstQuery(route.query[key]) ?? ''
}
function parsePage(value: string, fallback = 0) {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback
}
function setQuery(patch: Record<string, string | undefined>) {
  void router.replace({ query: { ...route.query, ...patch } })
}

const activeTab = computed<SeriesTab>(() => tabs.includes(routeValue('tab') as SeriesTab) ? routeValue('tab') as SeriesTab : 'sessions')
// Tabs are links: sessions is the default and carries no `tab` key; every other query key (returnTo, filters) is kept.
const tabLinks = computed(() => tabs.map(tab => ({
  key: `meeting-series-tab-${tab}`,
  label: t(`meetingTimeline.tabs.${tab}`),
  to: { query: { ...route.query, tab: tab === 'sessions' ? undefined : tab } },
  active: activeTab.value === tab,
})))

const ALL_STATES = '__all__'
const sessionStateSelect = computed({ get: () => occurrenceState.value || ALL_STATES, set: value => { occurrenceState.value = value === ALL_STATES ? '' : String(value) } })
const followupStateSelect = computed({ get: () => followupState.value || ALL_STATES, set: value => { followupState.value = value === ALL_STATES ? '' : String(value) } })
const sessionStateOptions = computed(() => [
  { value: ALL_STATES, label: t('meetingsUi.allStates') },
  ...['draft', 'confirmed', 'done', 'cancelled'].map(state => ({ value: state, label: t(`meetingsUi.state.${state}`) })),
])
const viewItems = computed(() => [
  { value: 'timeline', label: t('meetingTimeline.timelineView') },
  { value: 'table', label: t('meetingTimeline.tableView') },
])
const sessionSortOptions = computed(() => [
  { value: 'timeline', label: t('meetingTimeline.sortTimeline') },
  { value: 'date_desc', label: t('meetingTimeline.sortNewest') },
  { value: 'date_asc', label: t('meetingTimeline.sortOldest') },
  { value: 'name', label: t('meetingTimeline.sortName') },
])
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
// A tile links to the place that explains its number: the follow-up tab for the counts, the meeting for the dates.
function followupLink(state: 'active' | 'overdue') {
  return router.resolve({ query: { ...route.query, tab: 'followup', followup_state: state, followup_page: undefined } }).fullPath
}
function meetingLink(meeting: { id: number }) {
  return router.resolve({ path: `/meetings/${meeting.id}`, query: returnToQuery(route.fullPath) }).fullPath
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
  return Number.isNaN(parsed.getTime()) ? '—' : hydrated.value ? formatWebVueTime(parsed, locale.value) : ''
}
function occurrenceLabel(meeting: { meeting_date: string | null; start_datetime: string | null }) {
  const date = meeting.meeting_date ? formatCalendarDate(meeting.meeting_date, locale.value) : t('meetingTimeline.unknownDate')
  const time = meeting.start_datetime ? localTime(meeting.start_datetime) : ''
  return time ? `${date} · ${time}` : date
}
const addingOccurrence = ref(false)
const occurrenceName = ref('')
const occurrenceDate = ref('')
const occurrenceStart = ref('')
const occurrenceEnd = ref('')
const occurrenceDirty = computed(() => addingOccurrence.value && [occurrenceName.value, occurrenceDate.value, occurrenceStart.value, occurrenceEnd.value].some(Boolean))
const occurrenceDateField = computed({ get: () => occurrenceDate.value || null, set: value => { occurrenceDate.value = value || '' } })
const addOccurrence = useAddSeriesOccurrence()
const occurrenceErrors = computed(() => occurrenceFormErrors({ name: occurrenceName.value, date: occurrenceDate.value, start: occurrenceStart.value, end: occurrenceEnd.value }))
const occurrenceForm = ref<HTMLFormElement | null>(null)
const { visibleErrors: occurrenceVisibleErrors, validate: validateOccurrence } = useMeetingFormFeedback(occurrenceErrors, occurrenceForm)
const { fieldErrors: occurrenceServerErrors, submitError: occurrenceSubmitError } = useMeetingSubmitError({
  error: addOccurrence.error,
  reset: addOccurrence.reset,
  edits: () => [occurrenceName.value, occurrenceDate.value, occurrenceStart.value, occurrenceEnd.value],
  fields: { name: 'name', start_datetime: 'start', end_datetime: 'end' },
})
function closeOccurrenceForm() {
  addingOccurrence.value = false
  occurrenceName.value = occurrenceDate.value = occurrenceStart.value = occurrenceEnd.value = ''
  addOccurrence.reset()
}
async function submitOccurrence() {
  if (!hydrated.value || addOccurrence.isPending.value || id.value === null || !validateOccurrence()) return
  await addOccurrence.mutateAsync({
    seriesId: id.value,
    body: buildOccurrencePayload({ name: occurrenceName.value, date: occurrenceDate.value, start: occurrenceStart.value, end: occurrenceEnd.value }),
  })
  closeOccurrenceForm()
}
const canAddOccurrence = computed(() => {
  const series = query.data.value
  const userId = me.value?.id
  return can('meetings.create') && (can('meetings.manage') || (userId !== undefined && (series?.organizer?.id === userId || series?.secretary?.id === userId)))
})

const followupSearch = computed({ get: () => routeValue('followup_q'), set: value => setQuery({ followup_q: value.trim() || undefined, followup_page: undefined }) })
const followupState = computed({ get: () => routeValue('followup_state'), set: value => setQuery({ followup_state: value || undefined, followup_page: undefined }) })
const followupStateOptions = computed(() => [
  { value: ALL_STATES, label: t('meetingsUi.allStates') },
  ...['active', 'overdue', 'open', 'in_progress', 'done', 'cancelled'].map(state => ({ value: state, label: followupStateLabel(state) })),
])
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
  <SharedRecordPage :keep-content="!!query.data.value"
    v-if="isDetail"
    :title="query.data.value?.name ?? (pageError ? t('nav.meetingSeries') : '')"
    :description="headerDescription"
    :back-to="backTo"
    :loading="query.isLoading.value"
    :error="pageError"
    @retry="query.refetch()"
  >
    <template #actions>
      <UButton v-if="query.data.value?.can_edit === true" color="neutral" variant="outline" :to="recordChildTo(`/meetings/series/${id}/edit`, route.query, sourcePaths, route.hash)" :label="t('meetingsUx.seriesSettingsLink')" />
      <UButton v-if="canAddOccurrence && !addingOccurrence" icon="i-lucide-plus" :disabled="!hydrated" :label="t('meetingsUi.addOccurrence')" data-testid="meeting-add-occurrence" @click="addingOccurrence = true" />
    </template>
    <template #tabs>
      <SharedRouteTabs data-testid="meeting-series-tabs" variant="pill" :items="tabLinks" :ariaLabel="t('meetingTimeline.sections')" />
    </template>

    <div v-if="query.data.value" class="grid min-w-0 gap-(--webvue-gap-card)">
      <form v-if="addingOccurrence && canAddOccurrence" ref="occurrenceForm" novalidate data-testid="meeting-occurrence-form" @submit.prevent="submitOccurrence">
        <SharedUnsavedChanges :dirty="occurrenceDirty" />
        <SharedFormSection panel :title="t('meetingsUx.occurrence.title')" :description="t('meetingsUx.occurrence.hint')">
          <div class="webvue-form-grid">
            <UFormField class="sm:col-span-2" :label="t('meetingsUx.occurrence.name')" name="name" :error="occurrenceServerErrors.name">
              <UInput id="occurrence-name" v-model="occurrenceName" class="w-full" :disabled="!hydrated || addOccurrence.isPending.value" />
            </UFormField>
            <UFormField :label="t('meetingsUi.date')" name="date" :error="occurrenceVisibleErrors.date ? t(`meetingsUx.errors.${occurrenceVisibleErrors.date}`) : undefined">
              <SharedDateField id="occurrence-date" v-model="occurrenceDateField" class="w-full" :disabled="!hydrated || addOccurrence.isPending.value" :aria-invalid="!!occurrenceVisibleErrors.date" />
            </UFormField>
            <UFormField :label="t('meetingsUi.start')" name="start" :error="occurrenceServerErrors.start || (occurrenceVisibleErrors.start ? t(`meetingsUx.errors.${occurrenceVisibleErrors.start}`) : undefined)">
              <UInput id="occurrence-start" v-model="occurrenceStart" type="time" class="w-full" :disabled="!hydrated || addOccurrence.isPending.value" :aria-invalid="!!occurrenceVisibleErrors.start" />
            </UFormField>
            <UFormField :label="t('meetingsUi.end')" name="end" :error="occurrenceServerErrors.end || (occurrenceVisibleErrors.end ? t(`meetingsUx.errors.${occurrenceVisibleErrors.end}`) : undefined)">
              <UInput id="occurrence-end" v-model="occurrenceEnd" type="time" class="w-full" :disabled="!hydrated || addOccurrence.isPending.value" :aria-invalid="!!occurrenceVisibleErrors.end" />
            </UFormField>
          </div>
        </SharedFormSection>
        <UAlert v-if="addOccurrence.error.value" role="alert" color="error" variant="subtle" icon="i-lucide-circle-alert" class="mt-(--webvue-gap-card)" :title="occurrenceSubmitError" />
        <SharedFormActions class="mt-(--webvue-gap-card)">
          <div class="flex flex-wrap items-center gap-2">
            <UButton type="button" color="neutral" variant="outline" :disabled="addOccurrence.isPending.value" :label="t('app.cancel')" @click="closeOccurrenceForm" />
            <UButton type="submit" :disabled="!hydrated || addOccurrence.isPending.value" :loading="addOccurrence.isPending.value" :label="t('meetingsUx.occurrence.submit')" />
          </div>
        </SharedFormActions>
      </form>
      <section v-if="activeTab === 'sessions'" class="grid gap-(--webvue-gap-card)" data-testid="meeting-series-sessions">
        <SharedRecordSection :title="t('meetingTimeline.scheduleSummary')" :description="t('meetingTimeline.scheduleSummaryHint')">
          <div class="grid w-full min-w-0 gap-(--webvue-gap-card) sm:grid-cols-2 xl:grid-cols-4">
            <SharedMetricTile density="compact" icon="i-lucide-list-checks" :label="t('meetingTimeline.openTile')" :value="query.data.value.open_resolution_count" :to="followupLink('active')" />
            <SharedMetricTile density="compact" icon="i-lucide-triangle-alert" :tone="query.data.value.overdue_resolution_count ? 'danger' : 'neutral'" :label="t('meetingTimeline.overdueTile')" :value="query.data.value.overdue_resolution_count" :to="followupLink('overdue')" />
            <SharedMetricTile density="compact" icon="i-lucide-calendar-clock" :label="t('meetingsUi.nextMeeting')" :value="upcoming ? occurrenceLabel(upcoming) : '—'" :hint="upcoming ? upcoming.name : t('meetingsUx.noNextMeeting')" :to="upcoming ? meetingLink(upcoming) : undefined" />
            <SharedMetricTile density="compact" icon="i-lucide-calendar-check" :label="t('meetingTimeline.lastCompleted')" :value="previous ? occurrenceLabel(previous) : '—'" :hint="previous ? previous.name : t('meetingTimeline.noCompletedMeeting')" :to="previous ? meetingLink(previous) : undefined" />
          </div>
        </SharedRecordSection>
        <SharedListCard>
          <template #filters>
            <FilterBar embedded class="w-full" :active-count="activeSessionFilterCount" :clear-label="t('meetingsUi.clear')" :disabled="!hydrated" @clear="clearSessionFilters">
              <template #search>
                <UInput id="series-session-search" v-model="occurrenceSearch" icon="i-lucide-search" class="w-full" :disabled="!hydrated" :placeholder="t('meetingTimeline.searchSessions')" :aria-label="t('meetingTimeline.searchSessions')">
                  <template v-if="occurrenceSearch" #trailing>
                    <UButton type="button" color="neutral" variant="link" size="sm" icon="i-lucide-x" :aria-label="t('meetingsFilters.clearSearch')" class="-me-1" @click="occurrenceSearch = ''" />
                  </template>
                </UInput>
              </template>
              <template #default>
                <USelect data-testid="series-session-state" class="w-full md:w-44" icon="i-lucide-activity" :items="sessionStateOptions" :model-value="sessionStateSelect" :disabled="!hydrated" :aria-label="t('meetingsUi.stateLabel')" @update:model-value="sessionStateSelect = String($event)" />
                <USelect data-testid="series-session-sort" class="w-full md:w-44" icon="i-lucide-arrow-up-down" :items="sessionSortOptions" :model-value="occurrenceSort" :disabled="!hydrated" :aria-label="t('meetingTimeline.sort')" @update:model-value="occurrenceSort = String($event)" />
                <SharedDateField id="series-session-from" v-model="dateFromField" class="w-full md:w-44" :label="dateFromField ? undefined : t('meetingTimeline.from')" :aria-label="t('meetingTimeline.from')" :disabled="!hydrated" :aria-invalid="!validDateRange" />
                <SharedDateField id="series-session-to" v-model="dateToField" class="w-full md:w-44" :label="dateToField ? undefined : t('meetingTimeline.to')" :aria-label="t('meetingTimeline.to')" :disabled="!hydrated" :aria-invalid="!validDateRange" />
              </template>
              <template #view>
                <SharedSegmentedControl :label="t('meetingTimeline.scheduleSummary')" :items="viewItems" :model-value="occurrenceView" :disabled="!hydrated" @update:model-value="occurrenceView = $event === 'table' ? 'table' : 'timeline'" />
              </template>
            </FilterBar>
          </template>
          <UAlert v-if="!validDateRange" class="m-(--webvue-card-pad-dense)" role="alert" color="error" variant="subtle" :title="t('meetingTimeline.invalidDateRange')" />
          <MeetingTimeline :meetings="visibleMeetings" :next-meeting-id="upcoming?.id" :view="occurrenceView" bare :preserve-order="occurrenceSort !== 'timeline'" :return-to="route.fullPath" :now="now" />
          <template v-if="visibleMeetings.length" #footer>
            <span class="tabular-nums" data-testid="meeting-series-sessions-count">{{ t('meetingsUi.footer.results', { shown: visibleMeetings.length, total: filteredMeetings.length }, filteredMeetings.length) }}</span>
            <UButton v-if="hasMoreMeetings" color="neutral" variant="outline" size="sm" :disabled="!hydrated" :label="t('meetingTimeline.loadMore')" @click="loadMoreMeetings" />
          </template>
        </SharedListCard>
      </section>

      <section v-else-if="activeTab === 'followup'" class="grid gap-(--webvue-gap-card)" data-testid="meeting-series-followup">
        <SharedListCard>
          <template #filters>
            <FilterBar embedded class="w-full" :active-count="followupFilterCount" :clear-label="t('meetingsUi.clear')" :disabled="!hydrated" @clear="clearFollowupFilters">
              <template #search>
                <UInput id="series-followup-search" v-model="followupSearch" icon="i-lucide-search" class="w-full" :disabled="!hydrated" :placeholder="t('meetingTimeline.searchFollowup')" :aria-label="t('meetingTimeline.searchFollowup')">
                  <template v-if="followupSearch" #trailing>
                    <UButton type="button" color="neutral" variant="link" size="sm" icon="i-lucide-x" :aria-label="t('meetingsFilters.clearSearch')" class="-me-1" @click="followupSearch = ''" />
                  </template>
                </UInput>
              </template>
              <template #default>
                <USelect data-testid="series-followup-state" class="w-full md:w-48" icon="i-lucide-activity" :items="followupStateOptions" :model-value="followupStateSelect" :disabled="!hydrated" :aria-label="t('meetingsUi.stateLabel')" @update:model-value="followupStateSelect = String($event)" />
              </template>
            </FilterBar>
          </template>
          <SharedPageState :loading="followupQuery.isLoading.value" :error="followupQuery.error.value" :empty="!followupQuery.isLoading.value && !followupQuery.data.value?.items.length" :empty-text="t('meetingTimeline.noFollowup')" @retry="followupQuery.refetch">
            <ul class="divide-y divide-default">
              <li v-for="item in followupQuery.data.value?.items" :key="`${item.meeting_id}-${item.id}`" class="grid gap-2 px-(--webvue-card-pad) py-4">
                <div class="flex flex-wrap items-start justify-between gap-2">
                  <div class="grid min-w-0 gap-0.5">
                    <UButton color="primary" variant="link" class="w-fit p-0 text-base font-semibold whitespace-normal text-start" :to="{ path: `/meetings/${item.meeting_id}`, query: { ...returnToQuery(route.fullPath), tab: 'resolutions' } }">{{ item.name }}</UButton>
                    <p class="text-xs text-muted">{{ item.meeting_name }}</p>
                  </div>
                  <SharedStatusBadge v-bind="resolutionStateBadgeProps(item.execution_state || item.state, t, followupStateLabel(item.execution_state || item.state))" />
                </div>
                <dl class="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2 lg:grid-cols-4">
                  <div v-if="item.responsible" class="min-w-0"><dt class="text-xs text-muted">{{ t('meetingsUi.responsible') }}</dt><dd class="flex items-center gap-2 text-highlighted"><SharedPersonAvatar :people="[item.responsible]" /><span class="truncate">{{ item.responsible.name }}</span></dd></div>
                  <div v-if="resolutionText(item, 'deadline')" class="min-w-0"><dt class="text-xs text-muted">{{ t('meetingsUi.deadline') }}</dt><dd class="text-highlighted">{{ resolutionText(item, 'deadline') }}</dd></div>
                  <div v-if="resolutionText(item, 'execution_period')" class="min-w-0"><dt class="text-xs text-muted">{{ t('meetingTimeline.executionPeriod') }}</dt><dd class="text-highlighted">{{ resolutionText(item, 'execution_period') }}</dd></div>
                  <div v-if="resolutionProject(item)" class="min-w-0"><dt class="text-xs text-muted">{{ t('meetingsUi.project') }}</dt><dd><UButton color="primary" variant="link" size="sm" class="p-0" :to="`/projects/${resolutionProject(item)?.id}`" :label="resolutionProject(item)?.name" /></dd></div>
                </dl>
                <SharedRichText v-if="richTextHasContent(item.result)" :html="item.result" size="sm" />
                <UButton v-if="resolutionTaskId(item)" color="primary" variant="link" size="sm" class="w-fit p-0" :to="`/tasks/${resolutionTaskId(item)}`" target="_blank" rel="noopener" :label="t('meetingsUx.openTaskNewTab')" />
              </li>
            </ul>
          </SharedPageState>
          <template v-if="!followupQuery.error.value && followupQuery.data.value?.items.length" #footer>
            <SharedListFooter :count-label="t('meetingsUi.footer.results', { shown: followupQuery.data.value.items.length, total: followupQuery.data.value.total }, followupQuery.data.value.total)" count-test-id="meeting-series-followup-count" :page="followupPageNumber" :pages="followupPages" :disabled="followupQuery.isFetching.value" @update:page="setFollowupPage($event - 1)" />
          </template>
        </SharedListCard>
      </section>

      <section v-else-if="activeTab === 'history'" class="grid gap-(--webvue-gap-card)" data-testid="meeting-series-history">
        <MeetingEventList :title="t('meetingTimeline.historyTitle')" :description="t('meetingTimeline.historyHint')" :events="historyQuery.data.value?.items ?? []" :loading="historyQuery.isLoading.value" :error="historyQuery.error.value" :total="historyQuery.data.value?.total ?? 0" :page="historyPageNumber" :page-size="historyPageSize" @retry="historyQuery.refetch" @page="setHistoryPage" />
      </section>

      <section v-else class="grid gap-(--webvue-gap-card)" data-testid="meeting-series-details">
        <SharedRecordSection variant="panel" :title="t('meetingsUi.series')">
          <dl class="grid gap-x-6 gap-y-4 sm:grid-cols-2">
            <div class="min-w-0"><dt class="text-xs text-muted">{{ t('meetingsUi.organizer') }}</dt><dd class="text-highlighted">{{ query.data.value.organizer?.name || '—' }}</dd></div>
            <div class="min-w-0"><dt class="text-xs text-muted">{{ t('meetingsUi.recurrenceLabel') }}</dt><dd class="text-highlighted">{{ t(`meetingsUi.recurrence.${query.data.value.recurrence}`) }}</dd></div>
            <div v-if="query.data.value.meeting_url" class="min-w-0"><dt class="text-xs text-muted">{{ t('meetingsUi.url') }}</dt><dd><UButton color="primary" variant="link" class="p-0 break-all whitespace-normal text-start" :to="query.data.value.meeting_url" external target="_blank" rel="noopener" dir="ltr">{{ query.data.value.meeting_url }}</UButton></dd></div>
            <div class="min-w-0"><dt class="text-xs text-muted">{{ t('meetingsUx.attendees') }}</dt><dd class="text-highlighted">{{ query.data.value.attendees.map(person => person.name).join('، ') || '—' }}</dd></div>
            <div class="min-w-0"><dt class="text-xs text-muted">{{ t('meetingsUx.termination') }}</dt><dd class="text-highlighted">{{ query.data.value.until_count ? t('meetingsUx.terminationCount', { count: query.data.value.until_count }, query.data.value.until_count) : query.data.value.until_date ? formatCalendarDate(query.data.value.until_date, locale) : t('meetingsUx.terminationOpen') }}</dd></div>
          </dl>
        </SharedRecordSection>
      </section>
    </div>

    <template v-if="query.data.value" #summary>
      <SharedPropertiesPanel>
        <SharedPropertyRow :label="t('meetingsUi.project')" :value="query.data.value.project?.name" />
        <SharedPropertyRow :label="t('meetingsUi.secretary')" :value="query.data.value.secretary?.name" />
        <SharedPropertyRow :label="t('meetingsUi.location')" :value="query.data.value.location" />
        <SharedPropertyRow :label="t('meetingsUi.resolutions')" :value="`${t('meetingsUi.openCount', { count: query.data.value.open_resolution_count }, query.data.value.open_resolution_count)} · ${t('meetingsUi.overdueCount', { count: query.data.value.overdue_resolution_count })}`" />
      </SharedPropertiesPanel>
    </template>
  </SharedRecordPage>
  <NuxtPage v-else />
</template>
