<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import type { MeetingListItem } from '@webvue/contracts'
import { refDebounced } from '@vueuse/core'
import FilterBar from '@webvue/ui/app/components/shared/data/FilterBar.vue'
import RecordNumber from '@webvue/ui/app/components/shared/data/RecordNumber.vue'
import { recordNumberHeader } from '@webvue/ui/app/utils/recordNumberHeader'
import MeetingProjectFilter from '@/components/meetings/MeetingProjectFilter.vue'
import { formatCalendarDate, formatWebVueTime } from '@webvue/ui/app/composables/calendarDate'
import { useMeetingListQuerySync } from '@/composables/useMeetingListQuerySync'
import { usePeople } from '@/composables/usePeople'
import { useMeetings } from '@/composables/useMeetings'
import { useMeetingListKpis } from '@/composables/useMeetingKpis'
import { returnToQuery } from '@webvue/ui/app/utils/safeReturnTo'
import { formatLocalDateTime } from '@/utils/meetingDateTime'
import { meetingStateBadgeProps } from '@/utils/meetingStatus'
import { clearMeetingListFilters, meetingDateRange, parseMeetingListFilters, patchMeetingListQuery, type MeetingFilterKey, type MeetingFilterPatch } from '@/utils/meetingListFilters'
import { meetingViewRoute, meetingViewOptions } from '@/utils/meetingRoutes'
import { parseOffset } from '@/utils/routeQuery'

const route = useRoute()
const router = useRouter()
const { t, locale } = useI18n()
const hydrated = useHydrated()
const { can } = useAccess()
const hasProjectFilter = useRecordPickerAvailable('project')
const routeFilters = computed(() => parseMeetingListFilters(route.query))
const search = ref(routeFilters.value.q)
const state = ref(routeFilters.value.state)
const mine = ref(routeFilters.value.mine)
const organizerSearch = ref('')
const dateFrom = ref(routeFilters.value.dateFrom)
const dateTo = ref(routeFilters.value.dateTo)
const dateFromField = computed({ get: () => dateFrom.value || null, set: value => { dateFrom.value = value || '' } })
const dateToField = computed({ get: () => dateTo.value || null, set: value => { dateTo.value = value || '' } })
const debouncedSearch = refDebounced(search, 250)
const debouncedOrganizerSearch = refDebounced(organizerSearch, 250)
const organizerQuery = usePeople(debouncedOrganizerSearch)

const listPath = '/meetings'
const limit = 25
const offset = ref(parseOffset(route.query.offset))
const { isCurrentList, currentListQuery, liveListQuery, liveReturnTo, replaceListQuery, isPlainClick } = useMeetingListQuerySync({
  router,
  route,
  listPath,
  search,
  debouncedSearch,
  offset,
  livePatch: current => {
    const patch: MeetingFilterPatch = {}
    if (state.value !== current.state) patch.state = state.value || undefined
    if (mine.value !== current.mine) patch.mine = mine.value
    if (dateFrom.value !== current.dateFrom) patch.date_from = dateFrom.value || undefined
    if (dateTo.value !== current.dateTo) patch.date_to = dateTo.value || undefined
    return patch
  },
  syncFromRoute: to => {
    const next = parseMeetingListFilters(to.query)
    state.value = next.state
    mine.value = next.mine
    dateFrom.value = next.dateFrom
    dateTo.value = next.dateTo
  },
  onNavigationStart: handler => useNuxtApp().hook('webvue:navigation:start', handler),
})
function openRecord(event: MouseEvent, record: { id: number }) {
  if (!hydrated.value || !isCurrentList() || !isPlainClick(event)) return
  event.preventDefault()
  void router.push(meetingTo(record)).catch(() => undefined)
}
function openCreate(event: MouseEvent) {
  if (!can('meetings.create') || !hydrated.value || !isCurrentList() || !isPlainClick(event)) return
  if (!(event.target as Element | null)?.closest('[data-testid="meeting-new"]')) return
  event.preventDefault()
  void router.push({ path: `${listPath}/new`, query: returnToQuery(liveReturnTo()) }).catch(() => undefined)
}

const validStates = ['draft', 'confirmed', 'done', 'cancelled']
const ALL_STATES = '__all__'
const stateSelect = computed({
  get: () => state.value || ALL_STATES,
  set: value => { state.value = value === ALL_STATES ? '' : String(value) },
})
const stateOptions = computed(() => [
  { value: ALL_STATES, label: t('meetingsUi.allStates') },
  ...validStates.map(code => ({ value: code, label: t(`meetingsUi.state.${code}`) })),
])
const dateValidation = computed(() => meetingDateRange(dateFrom.value, dateTo.value))
const query = useMeetings(computed(() => ({
  q: debouncedSearch.value.trim() || undefined,
  state: validStates.includes(routeFilters.value.state) ? routeFilters.value.state : undefined,
  mine: routeFilters.value.mine || undefined,
  project_id: routeFilters.value.projectId,
  organizer_id: routeFilters.value.organizerId,
  date_from: !dateValidation.value.invalid && !dateValidation.value.reversed && dateValidation.value.fromValid ? routeFilters.value.dateFrom || undefined : undefined,
  date_to: !dateValidation.value.invalid && !dateValidation.value.reversed && dateValidation.value.toValid ? routeFilters.value.dateTo || undefined : undefined,
  series_id: routeFilters.value.seriesId,
  limit,
  offset: offset.value,
})))
// The tiles count under the scope filters only; each tile brings its own state and dates.
const kpis = useMeetingListKpis(() => ({
  q: debouncedSearch.value.trim() || undefined,
  mine: routeFilters.value.mine || undefined,
  project_id: routeFilters.value.projectId,
  organizer_id: routeFilters.value.organizerId,
  series_id: routeFilters.value.seriesId,
}))
const rows = computed(() => query.data.value?.items ?? [])
const total = computed(() => query.data.value?.total ?? 0)
// The list's total as a tag in the heading, once the first page has arrived.
const countTags = computed(() => query.data.value ? [{ label: t('meetingsUi.countTag', { count: total.value }, total.value), kind: 'count' as const }] : [])
const page = computed(() => Math.floor(offset.value / limit) + 1)
const pages = computed(() => Math.max(1, Math.ceil(total.value / limit)))
const projectId = computed(() => routeFilters.value.projectId)
const seriesId = computed(() => routeFilters.value.seriesId)
const projectName = ref('')
const rememberedOrganizers = ref<Record<number, string>>({})
watch(() => organizerQuery.data.value, people => {
  if (!people?.length) return
  const next = { ...rememberedOrganizers.value }
  for (const person of people) next[person.user_id] = person.name
  rememberedOrganizers.value = next
}, { immediate: true })
const organizerOptions = computed(() => {
  const people = (organizerQuery.data.value ?? []).map(person => ({ id: person.user_id, name: person.name }))
  const selected = routeFilters.value.organizerId
  if (selected && !people.some(person => person.id === selected)) people.unshift({ id: selected, name: rememberedOrganizers.value[selected] ?? t('meetingsFilters.selectedOrganizer') })
  return people
})
const selectedOrganizerLabel = computed(() => organizerOptions.value.find(person => person.id === routeFilters.value.organizerId)?.name ?? t('meetingsFilters.selectedOrganizer'))
const selectedState = computed(() => validStates.includes(routeFilters.value.state) ? routeFilters.value.state : '')
const activeFilterCount = computed(() => [
  search.value.trim(),
  selectedState.value,
  routeFilters.value.mine ? 'mine' : '',
  projectId.value,
  routeFilters.value.organizerId,
  routeFilters.value.dateFrom,
  routeFilters.value.dateTo,
  seriesId.value,
].filter(Boolean).length)
const invalidDateRange = computed(() => dateValidation.value.invalid || dateValidation.value.reversed)

function localTime(value: string | null) {
  if (!value) return ''
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return formatLocalDateTime(value)
  return hydrated.value ? formatWebVueTime(parsed, locale.value) : ''
}

function meetingRecordNumber(meeting: { reference: string; id: number }) {
  return meeting.reference.trim() || meeting.id
}

// Reading order: the record number as a muted `#` reference, then the title (the strongest text), date, organizer, state and resolutions.
const columns = computed<TableColumn<MeetingListItem>[]>(() => [
  { id: 'record_number', header: () => recordNumberHeader(t), meta: { class: { th: 'w-12 px-2 text-start', td: 'w-12 px-2 whitespace-nowrap' } } },
  { accessorKey: 'name', header: t('meetingsUi.title'), meta: { class: { th: 'w-2/5', td: 'max-w-0' } } },
  { accessorKey: 'meeting_date', header: t('meetingsUi.date') },
  { accessorKey: 'organizer', header: t('meetingsUi.organizer') },
  { accessorKey: 'state', header: t('meetingsUi.stateLabel') },
  { accessorKey: 'open_resolution_count', header: t('meetingsUi.resolutions') },
])

function meetingTo(meeting: { id: number }) {
  return { path: `/meetings/${meeting.id}`, query: returnToQuery(liveReturnTo()) }
}

const createTo = computed(() => ({ path: '/meetings/new', query: returnToQuery(liveReturnTo()) }))

watch(() => route.query.state, value => {
  const next = typeof value === 'string' ? value : ''
  if (next !== state.value) state.value = next
})
watch(() => route.query.mine, value => {
  const next = value === '1' || value === 'true'
  if (next !== mine.value) mine.value = next
})
watch(() => route.query.date_from, value => {
  const next = typeof value === 'string' ? value : ''
  if (next !== dateFrom.value) dateFrom.value = next
})
watch(() => route.query.date_to, value => {
  const next = typeof value === 'string' ? value : ''
  if (next !== dateTo.value) dateTo.value = next
})
watch([dateFrom, dateTo], ([from, to]) => {
  const current = parseMeetingListFilters(currentListQuery())
  if (from === current.dateFrom && to === current.dateTo) return
  void replaceListQuery(patchMeetingListQuery(liveListQuery(), {
    date_from: from || undefined,
    date_to: to || undefined,
  }))
})
function onStateChange(value: unknown) {
  stateSelect.value = String(value)
  applyFilters()
}
const scopeItems = computed(() => [
  { value: 'all', label: t('meetingsFilters.allMeetings') },
  { value: 'mine', label: t('meetingsUi.mine') },
])
function onScopeChange(value: unknown) {
  toggleMine(value === 'mine')
}
function toggleMine(value: boolean) {
  mine.value = value
  applyFilters()
}
function applyFilters() {
  void replaceListQuery(patchMeetingListQuery(liveListQuery(), {
    state: state.value || undefined,
    mine: mine.value,
    organizer_id: routeFilters.value.organizerId,
    date_from: dateFrom.value || undefined,
    date_to: dateTo.value || undefined,
  }))
}

function clearFilters() {
  search.value = ''
  state.value = ''
  mine.value = false
  organizerSearch.value = ''
  dateFrom.value = ''
  dateTo.value = ''
  void replaceListQuery(clearMeetingListFilters(liveListQuery()))
}
function clearFilter(key: MeetingFilterKey) {
  if (key === 'q') search.value = ''
  if (key === 'state') state.value = ''
  if (key === 'mine') mine.value = false
  if (key === 'date_from') dateFrom.value = ''
  if (key === 'date_to') dateTo.value = ''
  const patch = (key === 'mine' ? { mine: false } : { [key]: undefined }) as MeetingFilterPatch
  void replaceListQuery(patchMeetingListQuery(liveListQuery(), patch))
}
function setProject(value: number | undefined) {
  void replaceListQuery(patchMeetingListQuery(liveListQuery(), { project_id: value }))
}
function setOrganizer(value: unknown) {
  const selected = String(value)
  void replaceListQuery(patchMeetingListQuery(liveListQuery(), { organizer_id: selected ? Number(selected) : undefined }))
}
function setPage(next: number) {
  if (!hydrated.value || query.isFetching.value || next < 1 || next > pages.value) return
  offset.value = (next - 1) * limit
  void replaceListQuery(patchMeetingListQuery(liveListQuery(), { offset: offset.value || undefined }))
}
</script>

<template>
  <SharedListPage
    :title="t('nav.meetings')"
    :tags="countTags"
    :create-to="can('meetings.create') ? createTo : undefined"
    :create-label="t('nav.newMeeting')"
    create-test-id="meeting-new"
    kpi-toggle
    @click.capture="openCreate"
  >
    <SharedKpiStrip v-if="hydrated" :tiles="kpis.tiles.value" :loading="kpis.loading.value" :label="t('meetingsKpi.label')" data-testid="meeting-kpi-strip" />
    <SharedListCard>
      <template #filters>
        <FilterBar embedded class="w-full" :active-count="activeFilterCount" :clear-label="t('meetingsUi.clear')" :disabled="!hydrated" @clear="clearFilters">
          <template #search>
            <UInput id="meeting-search" v-model="search" icon="i-lucide-search" class="w-full" :disabled="!hydrated" :placeholder="t('meetingsFilters.searchMeetings')" :aria-label="t('meetingsFilters.searchMeetings')">
              <template v-if="search" #trailing>
                <UButton type="button" color="neutral" variant="link" size="sm" icon="i-lucide-x" :aria-label="t('meetingsFilters.clearSearch')" class="-me-1" @click="clearFilter('q')" />
              </template>
            </UInput>
          </template>
          <template #default>
            <USelect data-testid="meeting-state" class="w-full md:w-44" icon="i-lucide-activity" :items="stateOptions" :model-value="stateSelect" :disabled="!hydrated" :aria-label="t('meetingsUi.stateLabel')" @update:model-value="onStateChange" />
            <MeetingProjectFilter v-if="hasProjectFilter" id="meeting-project" hide-label class="w-full md:w-44" :model-value="projectId" @update:model-value="setProject" @resolved-name="projectName = $event" />
            <div class="grid w-full gap-1 md:w-44">
              <USelectMenu
                id="meeting-organizer"
                v-model:search-term="organizerSearch"
                :ignore-filter="true"
                class="w-full"
                icon="i-lucide-user"
                value-key="value"
                :model-value="routeFilters.organizerId ? String(routeFilters.organizerId) : 'all'"
                :items="[{ label: t('meetingsFilters.allOrganizers'), value: 'all' }, ...organizerOptions.map(person => ({ label: person.name, value: String(person.id) }))]"
                :disabled="!hydrated || organizerQuery.isLoading.value"
                :aria-label="t('meetingsFilters.organizer')"
                @update:model-value="setOrganizer($event === 'all' ? '' : $event)"
              />
              <p v-if="organizerQuery.isLoading.value" class="text-xs text-muted" role="status">{{ t('meetingsFilters.organizersLoading') }}</p>
              <div v-else-if="organizerQuery.error.value" class="flex items-center gap-2 text-xs text-error" role="alert"><span>{{ t('meetingsFilters.organizersError') }}</span><UButton type="button" color="neutral" variant="outline" size="sm" :disabled="!hydrated" :label="t('meetingsFilters.retry')" @click="organizerQuery.refetch()" /></div>
              <p v-else-if="!organizerOptions.length" class="text-xs text-muted">{{ t('meetingsFilters.noOrganizers') }}</p>
            </div>
            <SharedDateField id="meeting-date-from" v-model="dateFromField" class="w-full md:w-44" :label="dateFromField ? undefined : t('meetingsFilters.fromDateLabel')" :aria-label="t('meetingsFilters.fromDateLabel')" :disabled="!hydrated" />
            <SharedDateField id="meeting-date-to" v-model="dateToField" class="w-full md:w-44" :label="dateToField ? undefined : t('meetingsFilters.toDateLabel')" :aria-label="t('meetingsFilters.toDateLabel')" :disabled="!hydrated" />
          </template>
          <template #view>
            <SharedSegmentedControl data-testid="meeting-scope" :label="t('meetingsFilters.scope')" :items="scopeItems" :model-value="mine ? 'mine' : 'all'" :disabled="!hydrated" @update:model-value="onScopeChange" />
            <SharedViewSwitch model-value="list" :options="meetingViewOptions(t)" @update:model-value="value => router.push(meetingViewRoute(liveListQuery(), value === 'calendar' ? 'calendar' : 'list'))" />
          </template>
          <!-- The dropdowns show their own choice; only the series inherited from a link has no control, so it is the one chip. -->
          <template v-if="seriesId" #active>
            <SharedFilterChip :label="t('meetingsFilters.inheritedSeries')" @remove="clearFilter('series_id')" />
          </template>
        </FilterBar>
      </template>

      <UAlert v-if="invalidDateRange" class="m-(--webvue-card-pad-dense)" role="alert" color="error" variant="subtle" icon="i-lucide-circle-alert" :title="dateValidation.reversed ? t('meetingsFilters.reversedDates') : t('meetingsFilters.invalidDate')" />
      <SharedDataTable
        v-else
        bare
        :rows="rows"
        :columns="columns"
        row-key="id"
        :row-to="meetingTo"
        :loading="query.isLoading.value"
        :error="query.error.value"
        :empty-text="t(activeFilterCount ? 'app.noResults' : 'meetingsUi.empty')"
        :caption="t('nav.meetings')"
        @retry="query.refetch()"
      >
        <template #record_number-cell="{ row }"><RecordNumber :value="meetingRecordNumber(row.original)" /></template>
        <template #name-cell="{ row }">
          <NuxtLink
            :to="meetingTo(row.original)"
            @click.capture="openRecord($event, row.original)"
            data-testid="meeting-row"
            class="block min-w-0 truncate text-base font-semibold text-highlighted hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >{{ row.original.name }}</NuxtLink>
        </template>
        <template #meeting_date-cell="{ row }"><div class="grid gap-0.5 whitespace-nowrap"><span>{{ row.original.meeting_date ? formatCalendarDate(row.original.meeting_date, locale) : '—' }}</span><span class="text-xs text-muted">{{ row.original.start_datetime ? localTime(row.original.start_datetime) : t('meetingsUx.timeUnavailable') }}</span></div></template>
        <template #organizer-cell="{ row }">
          <div v-if="row.original.organizer" class="flex min-w-0 items-center gap-2"><SharedPersonAvatar :people="[row.original.organizer]" /><span class="min-w-0 truncate text-muted">{{ row.original.organizer.name }}</span></div>
          <span v-else class="text-muted">—</span>
        </template>
        <template #state-cell="{ row }"><SharedStatusBadge v-bind="meetingStateBadgeProps(row.original.state, t)" data-testid="meeting-row-state" /></template>
        <template #open_resolution_count-cell="{ row }"><span class="text-muted">{{ t('meetingsUi.openCount', { count: row.original.open_resolution_count }, row.original.open_resolution_count) }}</span></template>
        <template #mobile-row="{ row }">
          <NuxtLink :to="meetingTo(row)" @click.capture="openRecord($event, row)" class="grid min-w-0 gap-2 focus-visible:outline-none">
            <div class="flex min-w-0 items-start justify-between gap-2">
              <span class="min-w-0 break-words font-semibold text-highlighted">{{ row.name }}</span>
              <SharedStatusBadge v-bind="meetingStateBadgeProps(row.state, t)" class="shrink-0" />
            </div>
            <div class="flex min-w-0 flex-wrap gap-x-3 gap-y-1 text-sm text-muted">
              <RecordNumber :value="meetingRecordNumber(row)" />
              <span>{{ row.meeting_date ? formatCalendarDate(row.meeting_date, locale) : '—' }}</span>
              <span v-if="row.start_datetime">{{ localTime(row.start_datetime) }}</span>
              <span v-else>{{ t('meetingsUx.timeUnavailable') }}</span>
            </div>
          </NuxtLink>
        </template>
      </SharedDataTable>
      <template v-if="!invalidDateRange && !query.error.value && rows.length" #footer>
        <SharedListFooter :count-label="t('meetingsUi.footer.results', { shown: rows.length, total }, total)" count-test-id="meetings-result-count" :page="page" :pages="pages" :disabled="query.isFetching.value || !hydrated" @update:page="setPage" />
      </template>
    </SharedListCard>
  </SharedListPage>
</template>
