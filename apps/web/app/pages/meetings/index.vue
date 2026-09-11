<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import type { MeetingListItem } from '@nasq/contracts'
import { refDebounced } from '@vueuse/core'
import FilterBar from '@/components/shared/FilterBar.vue'
import RecordNumber from '@/components/shared/RecordNumber.vue'
import MeetingProjectFilter from '@/components/meetings/MeetingProjectFilter.vue'
import { formatCalendarDate, formatNasqTime } from '@/composables/calendarDate'
import { usePeople } from '@/composables/usePeople'
import { useMeetings } from '@/composables/useMeetings'
import { returnToQuery } from '@/utils/safeReturnTo'
import { formatLocalDateTime } from '@/utils/meetingDateTime'
import { clearMeetingListFilters, meetingDateRange, parseMeetingListFilters, patchMeetingListQuery, type MeetingFilterKey, type MeetingFilterPatch } from '@/utils/meetingListFilters'

const route = useRoute()
const router = useRouter()
const { t, locale } = useI18n()
const hydrated = useHydrated()
const { can } = useAccess()
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
const limit = 25
const offset = ref(parseOffset(route.query.offset))
const validStates = ['draft', 'confirmed', 'done', 'cancelled']
const ALL_STATES = '__all__'
const stateSelect = computed({
  get: () => state.value || ALL_STATES,
  set: value => { state.value = value === ALL_STATES ? '' : String(value) },
})
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
const page = computed(() => Math.floor(offset.value / limit) + 1)
const pages = computed(() => Math.max(1, Math.ceil((query.data.value?.total ?? 0) / limit)))
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
const hasActiveFilters = computed(() => activeFilterCount.value > 0)
const invalidDateRange = computed(() => dateValidation.value.invalid || dateValidation.value.reversed)

function parseOffset(value: unknown) {
  const raw = Array.isArray(value) ? value[0] : value
  const parsed = typeof raw === 'string' || typeof raw === 'number' ? Number(raw) : 0
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : 0
}

function localTime(value: string | null) {
  if (!value) return ''
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return formatLocalDateTime(value)
  return formatNasqTime(parsed, locale.value)
}

function meetingRecordNumber(meeting: { reference: string; id: number }) {
  return meeting.reference.trim() || meeting.id
}

const columns = computed<TableColumn<MeetingListItem>[]>(() => [
  { accessorKey: 'id', header: t('app.recordNumber') },
  { accessorKey: 'name', header: t('meetingsUi.title') },
  { accessorKey: 'meeting_date', header: t('meetingsUi.date') },
  { accessorKey: 'organizer', header: t('meetingsUi.organizer') },
  { accessorKey: 'state', header: t('meetingsUi.stateLabel') },
  { accessorKey: 'open_resolution_count', header: t('meetingsUi.resolutions') },
])

function meetingTo(meeting: MeetingListItem) {
  return { path: `/meetings/${meeting.id}`, query: returnToQuery(route.fullPath) }
}

watch(() => route.query.q, value => {
  const next = typeof value === 'string' ? value : ''
  if (next !== search.value) search.value = next
})
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
watch(() => route.query.offset, value => {
  const next = parseOffset(value)
  if (next !== offset.value) offset.value = next
})
watch([dateFrom, dateTo], ([from, to]) => {
  if (from === routeFilters.value.dateFrom && to === routeFilters.value.dateTo) return
  void router.replace({ query: patchMeetingListQuery(route.query, {
    date_from: from || undefined,
    date_to: to || undefined,
  }) })
})
watch(debouncedSearch, (value) => {
  const next = value.trim()
  const current = routeFilters.value.q
  if (next === current) return
  void router.replace({ query: patchMeetingListQuery(route.query, { q: next || undefined }) })
})
function toggleMine(value: boolean) {
  mine.value = value
  applyFilters()
}
function applyFilters() {
  void router.replace({ query: patchMeetingListQuery(route.query, {
    state: state.value || undefined,
    mine: mine.value,
    organizer_id: routeFilters.value.organizerId,
    date_from: dateFrom.value || undefined,
    date_to: dateTo.value || undefined,
  }) })
}

function clearFilters() {
  search.value = ''
  state.value = ''
  mine.value = false
  organizerSearch.value = ''
  dateFrom.value = ''
  dateTo.value = ''
  void router.replace({ query: clearMeetingListFilters(route.query) })
}
function clearFilter(key: MeetingFilterKey) {
  const patch = (key === 'mine' ? { mine: false } : { [key]: undefined }) as MeetingFilterPatch
  void router.replace({ query: patchMeetingListQuery(route.query, patch) })
}
function setProject(value: number | undefined) {
  void router.replace({ query: patchMeetingListQuery(route.query, { project_id: value }) })
}
function setOrganizer(value: unknown) {
  const selected = String(value)
  void router.replace({ query: patchMeetingListQuery(route.query, { organizer_id: selected ? Number(selected) : undefined }) })
}
function setPage(next: number) {
  if (!hydrated.value || query.isFetching.value || next < 1 || next > pages.value) return
  offset.value = (next - 1) * limit
  void router.replace({ query: patchMeetingListQuery(route.query, { offset: offset.value || undefined }) })
}
</script>

<template>
  <SharedPageContainer width="list">
    <SharedPageHeader :title="t('nav.meetings')" />
    <div class="w-full min-w-0">
      <FilterBar
        :title="t('filterCard.title')"
        :active-count="activeFilterCount"
        :clear-label="t('meetingsUi.clear')"
        :disabled="!hydrated"
        @clear="clearFilters"
      >
        <template #search>
          <UInput id="meeting-search" v-model="search" icon="i-lucide-search" class="w-full" :disabled="!hydrated" :placeholder="t('meetingsFilters.searchMeetings')" :aria-label="t('meetingsFilters.searchMeetings')" />
        </template>
        <div class="w-full min-w-0 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <div class="grid min-w-0 content-start gap-1">
            <label for="meeting-state" class="text-sm font-medium text-highlighted">{{ t('meetingsUi.stateLabel') }}</label>
            <USelect
              id="meeting-state"
              v-model="stateSelect"
              class="w-full"
              :disabled="!hydrated"
              :items="[{ label: t('meetingsUi.allStates'), value: ALL_STATES }, ...['draft', 'confirmed', 'done', 'cancelled'].map(code => ({ label: t(`meetingsUi.state.${code}`), value: code }))]"
              @update:model-value="applyFilters"
            />
          </div>
          <label class="flex min-h-9 items-center gap-2 self-end pb-1 text-sm">
            <UCheckbox :model-value="mine" :disabled="!hydrated" @update:model-value="toggleMine(Boolean($event))" />
            {{ t('meetingsUi.mine') }}
          </label>
          <div v-if="can('pmo.projects.read')" class="grid min-w-0 content-start gap-1">
            <label for="meeting-project" class="text-sm font-medium text-highlighted">{{ t('meetingsFilters.project') }}</label>
            <MeetingProjectFilter id="meeting-project" hide-label :model-value="projectId" @update:model-value="setProject" @resolved-name="projectName = $event" />
          </div>
          <div class="grid min-w-0 content-start gap-1">
            <label for="meeting-organizer-search" class="text-sm font-medium text-highlighted">{{ t('meetingsFilters.organizer') }}</label>
            <UInput id="meeting-organizer-search" v-model="organizerSearch" class="w-full" :disabled="!hydrated" :placeholder="t('meetingsFilters.organizerSearch')" :aria-label="t('meetingsFilters.organizerSearch')" />
            <USelectMenu
              id="meeting-organizer"
              class="w-full"
              value-key="value"
              :model-value="routeFilters.organizerId ? String(routeFilters.organizerId) : 'all'"
              :items="[{ label: t('meetingsFilters.allOrganizers'), value: 'all' }, ...organizerOptions.map(person => ({ label: person.name, value: String(person.id) }))]"
              :disabled="!hydrated || organizerQuery.isLoading.value"
              :aria-label="t('meetingsFilters.organizer')"
              @update:model-value="setOrganizer($event === 'all' ? '' : $event)"
            />
            <p v-if="organizerQuery.isLoading.value" class="text-xs text-muted-foreground" role="status">{{ t('meetingsFilters.organizersLoading') }}</p>
            <div v-else-if="organizerQuery.error.value" class="flex items-center gap-2 text-xs text-destructive" role="alert"><span>{{ t('meetingsFilters.organizersError') }}</span><UButton type="button" color="secondary" variant="outline" size="sm" :disabled="!hydrated" :label="t('meetingsFilters.retry')" @click="organizerQuery.refetch()" /></div>
            <p v-else-if="!organizerOptions.length" class="text-xs text-muted-foreground">{{ t('meetingsFilters.noOrganizers') }}</p>
          </div>
          <div class="grid min-w-0 content-start gap-1">
            <label for="meeting-date-from" class="text-sm font-medium text-highlighted">{{ t('meetingsFilters.fromDateLabel') }}</label>
            <SharedDateField id="meeting-date-from" v-model="dateFromField" class="w-full" :disabled="!hydrated" />
          </div>
          <div class="grid min-w-0 content-start gap-1">
            <label for="meeting-date-to" class="text-sm font-medium text-highlighted">{{ t('meetingsFilters.toDateLabel') }}</label>
            <SharedDateField id="meeting-date-to" v-model="dateToField" class="w-full" :disabled="!hydrated" />
          </div>
        </div>
        <template v-if="hasActiveFilters" #active>
          <div class="flex flex-wrap items-center gap-2">
            <UBadge v-if="search.trim()" color="neutral" variant="subtle" class="gap-1">{{ t('meetingsUi.searchValue', { value: search }) }}<UButton type="button" color="neutral" variant="ghost" size="xs" square :aria-label="t('meetingsFilters.removeFilter')" label="×" @click="clearFilter('q')" /></UBadge>
            <UBadge v-if="selectedState" color="neutral" variant="subtle" class="gap-1">{{ t(`meetingsUi.state.${selectedState}`) }}<UButton type="button" color="neutral" variant="ghost" size="xs" square :aria-label="t('meetingsFilters.removeFilter')" label="×" @click="clearFilter('state')" /></UBadge>
            <UBadge v-if="routeFilters.mine" color="neutral" variant="subtle" class="gap-1">{{ t('meetingsUi.mine') }}<UButton type="button" color="neutral" variant="ghost" size="xs" square :aria-label="t('meetingsFilters.removeFilter')" label="×" @click="clearFilter('mine')" /></UBadge>
            <UBadge v-if="projectId" color="neutral" variant="subtle" class="gap-1">{{ projectName || t('meetingsFilters.selectedProject') }}<UButton type="button" color="neutral" variant="ghost" size="xs" square :aria-label="t('meetingsFilters.removeFilter')" label="×" @click="clearFilter('project_id')" /></UBadge>
            <UBadge v-if="routeFilters.organizerId" color="neutral" variant="subtle" class="gap-1">{{ selectedOrganizerLabel }}<UButton type="button" color="neutral" variant="ghost" size="xs" square :aria-label="t('meetingsFilters.removeFilter')" label="×" @click="clearFilter('organizer_id')" /></UBadge>
            <UBadge v-if="routeFilters.dateFrom" color="neutral" variant="subtle" class="gap-1">{{ t('meetingsFilters.fromDate', { value: routeFilters.dateFrom }) }}<UButton type="button" color="neutral" variant="ghost" size="xs" square :aria-label="t('meetingsFilters.removeFilter')" label="×" @click="clearFilter('date_from')" /></UBadge>
            <UBadge v-if="routeFilters.dateTo" color="neutral" variant="subtle" class="gap-1">{{ t('meetingsFilters.toDate', { value: routeFilters.dateTo }) }}<UButton type="button" color="neutral" variant="ghost" size="xs" square :aria-label="t('meetingsFilters.removeFilter')" label="×" @click="clearFilter('date_to')" /></UBadge>
            <UBadge v-if="seriesId" color="neutral" variant="subtle" class="gap-1">{{ t('meetingsFilters.inheritedSeries') }}<UButton type="button" color="neutral" variant="ghost" size="xs" square :aria-label="t('meetingsFilters.removeFilter')" label="×" @click="clearFilter('series_id')" /></UBadge>
          </div>
        </template>
      </FilterBar>
    </div>
    <div v-if="invalidDateRange" class="rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive" role="alert">
      {{ dateValidation.reversed ? t('meetingsFilters.reversedDates') : t('meetingsFilters.invalidDate') }}
    </div>
    <SharedPageState
      v-else
      :loading="query.isLoading.value"
      :error="query.error.value"
      :empty="!query.isLoading.value && !(query.data.value?.items.length)"
      :empty-text="t('meetingsUi.empty')"
      @retry="query.refetch"
    >
      <div class="min-w-0 space-y-2">
        <div class="grid divide-y divide-border md:hidden">
          <NuxtLink
            v-for="meeting in query.data.value?.items"
            :key="meeting.id"
            :to="meetingTo(meeting)"
            class="grid min-w-0 gap-2 p-3 hover:bg-muted/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <div class="flex min-w-0 items-start justify-between gap-2">
              <span class="min-w-0 break-words font-medium text-brand-link">{{ meeting.name }}</span>
              <UBadge color="neutral" variant="subtle" class="shrink-0">{{ t(`meetingsUi.state.${meeting.state}`) }}</UBadge>
            </div>
            <div class="flex min-w-0 flex-wrap gap-x-3 gap-y-1 text-sm text-muted-foreground">
              <RecordNumber :value="meetingRecordNumber(meeting)" />
              <span>{{ meeting.meeting_date ? formatCalendarDate(meeting.meeting_date, locale) : '—' }}</span>
              <span v-if="meeting.start_datetime">{{ localTime(meeting.start_datetime) }}</span>
              <span v-else>{{ t('meetingsUx.timeUnavailable') }}</span>
            </div>
          </NuxtLink>
        </div>
        <div class="hidden overflow-x-auto md:block">
          <UTable :data="query.data.value?.items ?? []" :columns="columns" :caption="t('nav.meetings')" :ui="{ caption: 'sr-only' }">
            <template #id-cell="{ row }"><RecordNumber :value="meetingRecordNumber(row.original)" /></template>
            <template #name-cell="{ row }">
              <NuxtLink
                :to="meetingTo(row.original)"
                class="block rounded-sm font-medium text-brand-link hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >{{ row.original.name }}</NuxtLink>
            </template>
            <template #meeting_date-cell="{ row }">{{ row.original.meeting_date ? formatCalendarDate(row.original.meeting_date, locale) : '—' }}</template>
            <template #organizer-cell="{ row }">{{ row.original.organizer?.name || '—' }}</template>
            <template #state-cell="{ row }"><UBadge color="neutral" variant="subtle">{{ t(`meetingsUi.state.${row.original.state}`) }}</UBadge></template>
            <template #open_resolution_count-cell="{ row }">{{ t('meetingsUi.openCount', { count: row.original.open_resolution_count }) }}</template>
          </UTable>
        </div>
      </div>
    </SharedPageState>
    <nav v-if="!invalidDateRange && pages > 1" class="flex items-center justify-between text-sm text-muted-foreground">
      <UButton color="neutral" variant="ghost" :disabled="!hydrated || page === 1 || query.isFetching.value" :label="t('projects.previousPage')" @click="setPage(page - 1)" />
      <span>{{ t('meetingsUi.pageOf', { page, pages }) }}</span>
      <UButton color="neutral" variant="ghost" :disabled="!hydrated || page >= pages || query.isFetching.value" :label="t('projects.nextPage')" @click="setPage(page + 1)" />
    </nav>
  </SharedPageContainer>
</template>
