<script setup lang="ts">
import { Plus, Search } from '@lucide/vue'
import { refDebounced } from '@vueuse/core'
import FilterCard from '@/components/shared/FilterCard.vue'
import RecordNumber from '@/components/shared/RecordNumber.vue'
import MeetingProjectFilter from '@/components/meetings/MeetingProjectFilter.vue'
import { formatCalendarDate } from '@/composables/calendarDate'
import { usePeople } from '@/composables/usePeople'
import { useMeetings } from '@/composables/useMeetings'
import { returnToQuery } from '@/utils/safeReturnTo'
import { meetingCreateRoute } from '@/utils/meetingRoutes'
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
const debouncedSearch = refDebounced(search, 250)
const debouncedOrganizerSearch = refDebounced(organizerSearch, 250)
const organizerQuery = usePeople(debouncedOrganizerSearch)
const limit = 25
const offset = ref(parseOffset(route.query.offset))
const validStates = ['draft', 'confirmed', 'done', 'cancelled']
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
const createMeetingTo = computed(() => meetingCreateRoute(route.fullPath, projectId.value, seriesId.value))
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
  return new Intl.DateTimeFormat(locale.value, { timeStyle: 'short', calendar: 'gregory' }).format(parsed)
}

function meetingRecordNumber(meeting: { reference: string; id: number }) {
  return meeting.reference.trim() || meeting.id
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
    <SharedPageHeader :title="t('nav.meetings')">
      <template #actions>
        <NuxtLink v-if="can('meetings.create')" :to="createMeetingTo">
          <Button :disabled="!hydrated" class="gap-2">
            <Plus class="size-[18px]" />{{ t('meetingsUi.new') }}
          </Button>
        </NuxtLink>
      </template>
    </SharedPageHeader>
    <div class="w-full min-w-0">
      <FilterCard
        :title="t('filterCard.title')"
        :active-count="activeFilterCount"
        :clear-label="t('meetingsUi.clear')"
        :disabled="!hydrated"
        @clear="clearFilters"
      >
        <div class="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <div class="grid min-w-0 content-start gap-1 md:col-span-2 xl:col-span-2">
            <Label for="meeting-search">{{ t('meetingsFilters.searchMeetings') }}</Label>
            <div class="relative">
              <Search class="pointer-events-none absolute start-2 top-1/2 size-[18px] -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
              <Input id="meeting-search" v-model="search" :disabled="!hydrated" :placeholder="t('meetingsFilters.searchMeetings')" :aria-label="t('meetingsFilters.searchMeetings')" class="ps-8" />
            </div>
          </div>
          <div class="grid min-w-0 content-start gap-1">
            <Label for="meeting-state">{{ t('meetingsUi.stateLabel') }}</Label>
            <select id="meeting-state" v-model="state" class="border-input h-9 w-full rounded-lg border bg-transparent px-2 text-sm" :disabled="!hydrated" @change="applyFilters">
              <option value="">{{ t('meetingsUi.allStates') }}</option>
              <option v-for="code in ['draft', 'confirmed', 'done', 'cancelled']" :key="code" :value="code">{{ t(`meetingsUi.state.${code}`) }}</option>
            </select>
          </div>
          <label class="flex min-h-9 items-center gap-2 self-end pb-1 text-sm">
            <input v-model="mine" type="checkbox" :disabled="!hydrated" @change="applyFilters">
            {{ t('meetingsUi.mine') }}
          </label>
          <div v-if="can('pmo.projects.read')" class="grid min-w-0 content-start gap-1">
            <Label for="meeting-project">{{ t('meetingsFilters.project') }}</Label>
            <MeetingProjectFilter id="meeting-project" hide-label :model-value="projectId" @update:model-value="setProject" @resolved-name="projectName = $event" />
          </div>
          <div class="grid min-w-0 content-start gap-1">
            <Label for="meeting-organizer-search">{{ t('meetingsFilters.organizer') }}</Label>
            <Input id="meeting-organizer-search" v-model="organizerSearch" :disabled="!hydrated" :placeholder="t('meetingsFilters.organizerSearch')" :aria-label="t('meetingsFilters.organizerSearch')" />
            <select id="meeting-organizer" class="border-input h-9 w-full rounded-lg border bg-transparent px-2 text-sm" :value="routeFilters.organizerId ? String(routeFilters.organizerId) : 'all'" :disabled="!hydrated || organizerQuery.isLoading.value" :aria-label="t('meetingsFilters.organizer')" @change="setOrganizer(($event.target as HTMLSelectElement).value === 'all' ? '' : ($event.target as HTMLSelectElement).value)">
              <option value="all">{{ t('meetingsFilters.allOrganizers') }}</option>
              <option v-for="person in organizerOptions" :key="person.id" :value="String(person.id)">{{ person.name }}</option>
            </select>
            <p v-if="organizerQuery.isLoading.value" class="text-xs text-muted-foreground" role="status">{{ t('meetingsFilters.organizersLoading') }}</p>
            <div v-else-if="organizerQuery.error.value" class="flex items-center gap-2 text-xs text-destructive" role="alert"><span>{{ t('meetingsFilters.organizersError') }}</span><Button type="button" variant="outline" size="sm" :disabled="!hydrated" @click="organizerQuery.refetch()">{{ t('meetingsFilters.retry') }}</Button></div>
            <p v-else-if="!organizerOptions.length" class="text-xs text-muted-foreground">{{ t('meetingsFilters.noOrganizers') }}</p>
          </div>
          <div class="grid min-w-0 content-start gap-1">
            <Label for="meeting-date-from">{{ t('meetingsFilters.fromDateLabel') }}</Label>
            <Input id="meeting-date-from" v-model="dateFrom" type="date" :disabled="!hydrated" />
          </div>
          <div class="grid min-w-0 content-start gap-1">
            <Label for="meeting-date-to">{{ t('meetingsFilters.toDateLabel') }}</Label>
            <Input id="meeting-date-to" v-model="dateTo" type="date" :disabled="!hydrated" />
          </div>
        </div>
        <template v-if="hasActiveFilters" #active>
          <div class="flex flex-wrap items-center gap-2">
            <Badge v-if="search.trim()" variant="secondary" class="gap-1">{{ t('meetingsUi.searchValue', { value: search }) }}<button type="button" :aria-label="t('meetingsFilters.removeFilter')" @click="clearFilter('q')">×</button></Badge>
            <Badge v-if="selectedState" variant="secondary" class="gap-1">{{ t(`meetingsUi.state.${selectedState}`) }}<button type="button" :aria-label="t('meetingsFilters.removeFilter')" @click="clearFilter('state')">×</button></Badge>
            <Badge v-if="routeFilters.mine" variant="secondary" class="gap-1">{{ t('meetingsUi.mine') }}<button type="button" :aria-label="t('meetingsFilters.removeFilter')" @click="clearFilter('mine')">×</button></Badge>
            <Badge v-if="projectId" variant="secondary" class="gap-1">{{ projectName || t('meetingsFilters.selectedProject') }}<button type="button" :aria-label="t('meetingsFilters.removeFilter')" @click="clearFilter('project_id')">×</button></Badge>
            <Badge v-if="routeFilters.organizerId" variant="secondary" class="gap-1">{{ selectedOrganizerLabel }}<button type="button" :aria-label="t('meetingsFilters.removeFilter')" @click="clearFilter('organizer_id')">×</button></Badge>
            <Badge v-if="routeFilters.dateFrom" variant="secondary" class="gap-1">{{ t('meetingsFilters.fromDate', { value: routeFilters.dateFrom }) }}<button type="button" :aria-label="t('meetingsFilters.removeFilter')" @click="clearFilter('date_from')">×</button></Badge>
            <Badge v-if="routeFilters.dateTo" variant="secondary" class="gap-1">{{ t('meetingsFilters.toDate', { value: routeFilters.dateTo }) }}<button type="button" :aria-label="t('meetingsFilters.removeFilter')" @click="clearFilter('date_to')">×</button></Badge>
            <Badge v-if="seriesId" variant="secondary" class="gap-1">{{ t('meetingsFilters.inheritedSeries') }}<button type="button" :aria-label="t('meetingsFilters.removeFilter')" @click="clearFilter('series_id')">×</button></Badge>
          </div>
        </template>
      </FilterCard>
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
      <div class="nasq-panel overflow-hidden">
        <div class="grid divide-y divide-border md:hidden">
          <NuxtLink
            v-for="meeting in query.data.value?.items"
            :key="meeting.id"
            :to="{ path: `/meetings/${meeting.id}`, query: returnToQuery(route.fullPath) }"
            class="grid min-w-0 gap-2 p-3 hover:bg-muted/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <div class="flex min-w-0 items-start justify-between gap-2">
              <span class="min-w-0 break-words font-medium text-primary">{{ meeting.name }}</span>
              <Badge variant="secondary" class="shrink-0">{{ t(`meetingsUi.state.${meeting.state}`) }}</Badge>
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
        <div class="overflow-x-auto">
          <Table class="min-w-[800px]" :aria-label="t('nav.meetings')">
          <TableHeader>
            <TableRow>
              <TableHead scope="col" class="w-28">{{ t('app.recordNumber') }}</TableHead>
              <TableHead scope="col">{{ t('meetingsUi.title') }}</TableHead>
              <TableHead scope="col">{{ t('meetingsUi.date') }}</TableHead>
              <TableHead scope="col">{{ t('meetingsUi.organizer') }}</TableHead>
              <TableHead scope="col">{{ t('meetingsUi.stateLabel') }}</TableHead>
              <TableHead scope="col">{{ t('meetingsUi.resolutions') }}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow v-for="meeting in query.data.value?.items" :key="meeting.id">
              <TableCell class="w-28"><RecordNumber :value="meetingRecordNumber(meeting)" /></TableCell>
              <TableCell class="min-w-56 whitespace-normal">
                <NuxtLink
                  :to="{ path: `/meetings/${meeting.id}`, query: returnToQuery(route.fullPath) }"
                  class="block rounded-sm font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {{ meeting.name }}
                </NuxtLink>
              </TableCell>
              <TableCell class="text-muted-foreground">
                {{ meeting.meeting_date ? formatCalendarDate(meeting.meeting_date, locale) : '—' }}
              </TableCell>
              <TableCell class="whitespace-normal">{{ meeting.organizer?.name || '—' }}</TableCell>
              <TableCell>
                <Badge variant="secondary">{{ t(`meetingsUi.state.${meeting.state}`) }}</Badge>
              </TableCell>
              <TableCell class="text-muted-foreground">
                {{ t('meetingsUi.openCount', { count: meeting.open_resolution_count }) }}
              </TableCell>
            </TableRow>
          </TableBody>
          </Table>
        </div>
        </div>
      </div>
    </SharedPageState>
    <nav v-if="!invalidDateRange && pages > 1" class="flex items-center justify-between text-sm text-muted-foreground">
      <Button variant="ghost" :disabled="!hydrated || page === 1 || query.isFetching.value" @click="setPage(page - 1)">
        {{ t('projects.previousPage') }}
      </Button>
      <span>{{ t('meetingsUi.pageOf', { page, pages }) }}</span>
      <Button variant="ghost" :disabled="!hydrated || page >= pages || query.isFetching.value" @click="setPage(page + 1)">
        {{ t('projects.nextPage') }}
      </Button>
    </nav>
  </SharedPageContainer>
</template>
