<script setup lang="ts">
import { owningListBack, recordChildTo, SERIES_LIST_PATHS } from '@/utils/recordListOrigin'
import FilterBar from '@/components/shared/FilterBar.vue'
import MeetingEventList from '@/components/meetings/MeetingEventList.vue'
import MeetingTimeline from '@/components/meetings/MeetingTimeline.vue'
import { useMeetingSeries } from '@/composables/useMeetings'
import { useMeetingEvents, useMeetingSeriesResolutions } from '@/composables/useMeetingWorkspace'
import { formatCalendarDate, formatNasqTime } from '@/composables/calendarDate'
import { isCalendarDate } from '@/composables/calendarDate'
import { meetingTimestamp, prioritizeTimelinePage, selectNextMeeting, selectPreviousMeeting } from '@/utils/meetingWorkspace'
import { resolutionStateColor } from '@/utils/meetingStatus'
import { richTextHasContent } from '@/utils/richText'
import { firstQuery } from '@/utils/routeQuery'
import { sectionTabsUi } from '@/utils/sectionTabs'

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
const backTo = computed(() => owningListBack(route.query, SERIES_LIST_PATHS, route.hash))
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
const ALL_STATES = '__all__'
const sessionStateSelect = computed({ get: () => occurrenceState.value || ALL_STATES, set: value => { occurrenceState.value = value === ALL_STATES ? '' : String(value) } })
const followupStateSelect = computed({ get: () => followupState.value || ALL_STATES, set: value => { followupState.value = value === ALL_STATES ? '' : String(value) } })
const sessionStateOptions = computed(() => [
  { value: ALL_STATES, label: t('meetingsUi.allStates') },
  ...['draft', 'confirmed', 'done', 'cancelled'].map(state => ({ value: state, label: t(`meetingsUi.state.${state}`) })),
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
  <SharedPageContainer v-if="isDetail" width="detail">
    <SharedPageHeader :title="query.data.value?.name || t('nav.meetingSeries')" :description="headerDescription" :back-to="backTo">
      <template #actions>
        <UButton v-if="query.data.value?.can_edit === true" color="neutral" variant="outline" :to="recordChildTo(`/meetings/series/${id}/edit`, route.query, SERIES_LIST_PATHS, route.hash)" :label="t('meetingsUx.seriesSettingsLink')" />
        <UButton v-if="canAddOccurrence" :disabled="!hydrated" :to="{ path: '/meetings/new', query: { series_id: String(id) } }" :label="t('meetingsUi.addOccurrence')" />
      </template>
    </SharedPageHeader>
    <SharedPageState :loading="query.isLoading.value" :error="query.error.value" @retry="query.refetch">
      <template v-if="query.data.value">
        <UTabs
          :model-value="activeTab"
          :items="tabs.map(tab => ({ label: t(`meetingTimeline.tabs.${tab}`), value: tab, disabled: !hydrated }))"
          variant="link"
          :content="false"
          class="min-w-0"
          :ui="sectionTabsUi"
          :aria-label="t('meetingTimeline.sections')"
          @update:model-value="setTab"
        />

        <section v-if="activeTab === 'sessions'" class="grid gap-4" data-testid="meeting-series-sessions">
          <UCard>
            <div class="grid gap-4">
              <div class="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 class="text-lg font-semibold text-highlighted">{{ t('meetingTimeline.scheduleSummary') }}</h2>
                  <p class="mt-1 text-sm text-muted">{{ t('meetingTimeline.scheduleSummaryHint') }}</p>
                </div>
                <UTabs
                  :model-value="occurrenceView"
                  :items="[{ label: t('meetingTimeline.timelineView'), value: 'timeline', disabled: !hydrated }, { label: t('meetingTimeline.tableView'), value: 'table', disabled: !hydrated }]"
                  :content="false"
                  size="sm"
                  :aria-label="t('meetingTimeline.scheduleSummary')"
                  @update:model-value="occurrenceView = $event === 'table' ? 'table' : 'timeline'"
                />
              </div>
              <div class="flex flex-wrap gap-2">
                <UButton color="primary" variant="subtle" size="sm" :to="{ query: { ...route.query, tab: 'followup', followup_state: 'active', followup_page: undefined } }" :label="t('meetingsUi.openCount', { count: query.data.value.open_resolution_count })" />
                <UButton color="error" variant="subtle" size="sm" :to="{ query: { ...route.query, tab: 'followup', followup_state: 'overdue', followup_page: undefined } }" :label="t('meetingsUi.overdueCount', { count: query.data.value.overdue_resolution_count })" />
              </div>
              <div class="grid w-full min-w-0 gap-3 sm:grid-cols-2">
                <div class="rounded-lg p-3 ring ring-default">
                  <p class="text-sm text-muted">{{ t('meetingsUi.nextMeeting') }}</p>
                  <div v-if="upcoming" class="mt-1 grid gap-1">
                    <UButton color="primary" variant="link" class="w-fit p-0 font-medium whitespace-normal text-start" :to="`/meetings/${upcoming.id}`">{{ upcoming.name }}</UButton>
                    <span class="text-sm text-muted">{{ occurrenceLabel(upcoming) }}</span>
                  </div>
                  <p v-else class="mt-1 text-sm text-muted">{{ t('meetingsUx.noNextMeeting') }}</p>
                </div>
                <div class="rounded-lg p-3 ring ring-default">
                  <p class="text-sm text-muted">{{ t('meetingTimeline.lastCompleted') }}</p>
                  <div v-if="previous" class="mt-1 grid gap-1">
                    <UButton color="primary" variant="link" class="w-fit p-0 font-medium whitespace-normal text-start" :to="`/meetings/${previous.id}`">{{ previous.name }}</UButton>
                    <span class="text-sm text-muted">{{ occurrenceLabel(previous) }}</span>
                  </div>
                  <p v-else class="mt-1 text-sm text-muted">{{ t('meetingTimeline.noCompletedMeeting') }}</p>
                </div>
              </div>
            </div>
          </UCard>
          <FilterBar :title="t('filterCard.title')" :active-count="activeSessionFilterCount" :clear-label="t('meetingsUi.clear')" :disabled="!hydrated" @clear="clearSessionFilters">
            <template #search>
              <UInput id="series-session-search" v-model="occurrenceSearch" icon="i-lucide-search" class="w-full" :disabled="!hydrated" :placeholder="t('meetingTimeline.searchSessions')" :aria-label="t('meetingTimeline.searchSessions')" />
            </template>
            <template #default>
              <SharedFilterChoice data-testid="series-session-state" :label="t('meetingsUi.stateLabel')" :items="sessionStateOptions" :model-value="sessionStateSelect" :disabled="!hydrated" @update:model-value="sessionStateSelect = String($event)" />
              <SharedFilterChoice data-testid="series-session-sort" :label="t('meetingTimeline.sort')" :items="sessionSortOptions" :model-value="occurrenceSort" :disabled="!hydrated" @update:model-value="occurrenceSort = String($event)" />
              <SharedFilterField :label="t('meetingTimeline.from')" for="series-session-from">
                <SharedDateField id="series-session-from" v-model="dateFromField" class="w-full" :disabled="!hydrated" :aria-invalid="!validDateRange" />
              </SharedFilterField>
              <SharedFilterField :label="t('meetingTimeline.to')" for="series-session-to">
                <SharedDateField id="series-session-to" v-model="dateToField" class="w-full" :disabled="!hydrated" :aria-invalid="!validDateRange" />
              </SharedFilterField>
              <UAlert v-if="!validDateRange" role="alert" color="error" variant="subtle" :title="t('meetingTimeline.invalidDateRange')" />
            </template>
            <template #active>
              <div class="flex flex-wrap items-center gap-2">
                <SharedFilterChip v-if="occurrenceSearch.trim()" :label="t('meetingsUi.searchValue', { value: occurrenceSearch })" @remove="occurrenceSearch = ''" />
                <SharedFilterChip v-if="occurrenceState" :label="t(`meetingsUi.state.${occurrenceState}`)" @remove="occurrenceState = ''" />
                <SharedFilterChip v-if="dateFrom" :label="t('meetingsFilters.fromDate', { value: dateFrom })" @remove="dateFrom = ''" />
                <SharedFilterChip v-if="dateTo" :label="t('meetingsFilters.toDate', { value: dateTo })" @remove="dateTo = ''" />
              </div>
            </template>
          </FilterBar>
          <UCard v-if="occurrenceView === 'timeline' && visibleMeetings.length"><MeetingTimeline :meetings="visibleMeetings" :next-meeting-id="upcoming?.id" view="timeline" :preserve-order="occurrenceSort !== 'timeline'" :return-to="route.fullPath" :now="now" /></UCard>
          <MeetingTimeline v-else :meetings="visibleMeetings" :next-meeting-id="upcoming?.id" :view="occurrenceView" :preserve-order="occurrenceSort !== 'timeline'" :return-to="route.fullPath" :now="now" />
          <div v-if="hasMoreMeetings" class="flex justify-center"><UButton color="neutral" variant="outline" :disabled="!hydrated" :label="t('meetingTimeline.loadMore')" @click="loadMoreMeetings" /></div>
        </section>

        <section v-else-if="activeTab === 'followup'" class="grid gap-4" data-testid="meeting-series-followup">
          <FilterBar :title="t('meetingTimeline.followupTitle')" :active-count="followupFilterCount" :clear-label="t('meetingsUi.clear')" :disabled="!hydrated" @clear="clearFollowupFilters">
            <template #search>
              <UInput id="series-followup-search" v-model="followupSearch" icon="i-lucide-search" class="w-full" :disabled="!hydrated" :placeholder="t('meetingTimeline.searchFollowup')" :aria-label="t('meetingTimeline.searchFollowup')" />
            </template>
            <template #default>
              <SharedFilterChoice data-testid="series-followup-state" :label="t('meetingsUi.stateLabel')" :items="followupStateOptions" :model-value="followupStateSelect" :disabled="!hydrated" @update:model-value="followupStateSelect = String($event)" />
            </template>
            <template #active>
              <div class="flex flex-wrap items-center gap-2">
                <SharedFilterChip v-if="followupSearch.trim()" :label="t('meetingsUi.searchValue', { value: followupSearch })" @remove="followupSearch = ''" />
                <SharedFilterChip v-if="followupState" :label="followupStateLabel(followupState)" @remove="followupState = ''" />
              </div>
            </template>
          </FilterBar>
          <SharedPageState :loading="followupQuery.isLoading.value" :error="followupQuery.error.value" :empty="!followupQuery.isLoading.value && !followupQuery.data.value?.items.length" :empty-text="t('meetingTimeline.noFollowup')" @retry="followupQuery.refetch">
            <ul class="grid divide-y divide-default overflow-hidden rounded-lg bg-default ring ring-default">
              <li v-for="item in followupQuery.data.value?.items" :key="`${item.meeting_id}-${item.id}`" class="grid gap-2 p-4">
                <div class="flex flex-wrap items-start justify-between gap-2">
                  <div class="grid min-w-0 gap-0.5">
                    <UButton color="primary" variant="link" class="w-fit p-0 font-medium whitespace-normal text-start" :to="{ path: `/meetings/${item.meeting_id}`, query: { tab: 'resolutions' } }">{{ item.name }}</UButton>
                    <p class="text-xs text-muted">{{ item.meeting_name }}</p>
                  </div>
                  <UBadge :color="resolutionStateColor(item.execution_state || item.state)" variant="subtle">{{ followupStateLabel(item.execution_state || item.state) }}</UBadge>
                </div>
                <div class="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted">
                  <span v-if="resolutionText(item, 'deadline')">{{ t('meetingsUi.deadline') }}: {{ resolutionText(item, 'deadline') }}</span>
                  <span v-if="resolutionText(item, 'execution_period')">{{ t('meetingTimeline.executionPeriod') }}: {{ resolutionText(item, 'execution_period') }}</span>
                  <UButton v-if="resolutionProject(item)" color="primary" variant="link" size="sm" class="p-0" :to="`/projects/${resolutionProject(item)?.id}`" :label="`${t('meetingsUi.project')}: ${resolutionProject(item)?.name}`" />
                </div>
                <p v-if="item.responsible" class="text-sm text-muted">{{ t('meetingsUi.responsible') }}: {{ item.responsible.name }}</p>
                <SharedRichText v-if="richTextHasContent(item.result)" :html="item.result" size="sm" />
                <UButton v-if="resolutionTaskId(item)" color="primary" variant="link" size="sm" class="w-fit p-0" :to="`/tasks/${resolutionTaskId(item)}`" :label="t('meetingsUi.openTask')" />
              </li>
            </ul>
          </SharedPageState>
          <SharedPagination :page="followupPageNumber" :pages="followupPages" :disabled="followupQuery.isFetching.value" @update:page="setFollowupPage($event - 1)" />
        </section>

        <section v-else-if="activeTab === 'history'" class="grid gap-4" data-testid="meeting-series-history">
          <UCard><h2 class="text-lg font-semibold text-highlighted">{{ t('meetingTimeline.historyTitle') }}</h2><p class="mt-1 text-sm text-muted">{{ t('meetingTimeline.historyHint') }}</p></UCard>
          <MeetingEventList :events="historyQuery.data.value?.items ?? []" :loading="historyQuery.isLoading.value" :error="historyQuery.error.value" :total="historyQuery.data.value?.total ?? 0" :page="historyPageNumber" :page-size="historyPageSize" @retry="historyQuery.refetch" @page="setHistoryPage" />
        </section>

        <section v-else class="grid gap-4" data-testid="meeting-series-details">
          <UCard>
            <template #header><h2 class="text-lg font-semibold text-highlighted">{{ t('meetingsUi.series') }}</h2></template>
            <dl class="grid gap-4 sm:grid-cols-2">
              <div class="min-w-0"><dt class="text-sm text-muted">{{ t('meetingsUi.organizer') }}</dt><dd class="text-highlighted">{{ query.data.value.organizer?.name || '—' }}</dd></div>
              <div class="min-w-0"><dt class="text-sm text-muted">{{ t('meetingsUi.recurrenceLabel') }}</dt><dd class="text-highlighted">{{ t(`meetingsUi.recurrence.${query.data.value.recurrence}`) }}</dd></div>
              <div class="min-w-0"><dt class="text-sm text-muted">{{ t('meetingsUi.project') }}</dt><dd class="text-highlighted">{{ query.data.value.project?.name || '—' }}</dd></div>
              <div class="min-w-0"><dt class="text-sm text-muted">{{ t('meetingsUi.secretary') }}</dt><dd class="text-highlighted">{{ query.data.value.secretary?.name || '—' }}</dd></div>
              <div class="min-w-0"><dt class="text-sm text-muted">{{ t('meetingsUi.location') }}</dt><dd class="break-words text-highlighted">{{ query.data.value.location || '—' }}</dd></div>
              <div v-if="query.data.value.meeting_url" class="min-w-0"><dt class="text-sm text-muted">{{ t('meetingsUi.url') }}</dt><dd><UButton color="primary" variant="link" class="p-0 break-all whitespace-normal text-start" :to="query.data.value.meeting_url" external target="_blank" rel="noopener" dir="ltr">{{ query.data.value.meeting_url }}</UButton></dd></div>
              <div class="min-w-0"><dt class="text-sm text-muted">{{ t('meetingsUx.attendees') }}</dt><dd class="text-highlighted">{{ query.data.value.attendees.map(person => person.name).join('، ') || '—' }}</dd></div>
              <div class="min-w-0"><dt class="text-sm text-muted">{{ t('meetingsUx.termination') }}</dt><dd class="text-highlighted">{{ query.data.value.until_count ? t('meetingsUx.terminationCount', { count: query.data.value.until_count }) : query.data.value.until_date ? formatCalendarDate(query.data.value.until_date, locale) : t('meetingsUx.terminationOpen') }}</dd></div>
              <div class="min-w-0"><dt class="text-sm text-muted">{{ t('meetingsUi.openCount', { count: query.data.value.open_resolution_count }) }}</dt><dd class="text-highlighted">{{ t('meetingsUi.overdueCount', { count: query.data.value.overdue_resolution_count }) }}</dd></div>
            </dl>
          </UCard>
        </section>
      </template>
    </SharedPageState>
  </SharedPageContainer>
  <NuxtPage v-else />
</template>
