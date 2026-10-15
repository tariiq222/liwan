<script setup lang="ts">
import FilterBar from '@/components/shared/data/FilterBar.vue'
import MeetingProjectFilter from '@/components/meetings/MeetingProjectFilter.vue'
import { useMeetings } from '@/composables/useMeetings'
import { returnToQuery } from '@/utils/safeReturnTo'
import { formatCalendarDate, formatNasqTime, isCalendarDate } from '@/composables/calendarDate'
import { formatLocalDateTime } from '@/utils/meetingDateTime'
import { parseMeetingListFilters, patchMeetingListQuery, type MeetingFilterPatch } from '@/utils/meetingListFilters'
import { calendarCoverage } from '@/utils/meetingWorkspace'
import { meetingStateBadgeProps } from '@/utils/meetingStatus'
import { firstQuery } from '@/utils/routeQuery'

const route = useRoute()
const router = useRouter()
const { t, locale } = useI18n()
const hydrated = useHydrated()
const { can } = useAccess()
const MIN_YEAR = 1970
const MAX_YEAR = 2100
const CALENDAR_PAGE_LIMIT = 2000
// A meeting that starts this many days (or fewer) before the month and runs into it is still fetched.
const MULTI_DAY_LOOKBACK_DAYS = 7
const queryYear = Number(firstQuery(route.query.year))
const queryMonth = Number(firstQuery(route.query.month))
const queryRangeValid = Number.isInteger(queryYear) && queryYear >= MIN_YEAR && queryYear <= MAX_YEAR
  && Number.isInteger(queryMonth) && queryMonth >= 1 && queryMonth <= 12
const cursor = ref(queryRangeValid
  ? new Date(queryYear, queryMonth - 1, 1)
  : new Date(new Date().getFullYear(), new Date().getMonth(), 1))
const year = computed(() => cursor.value.getFullYear())
const month = computed(() => cursor.value.getMonth())
const monthPrefix = computed(() => `${year.value}-${String(month.value + 1).padStart(2, '0')}`)
const dateFrom = computed(() => dateKey(new Date(year.value, month.value, 1 - MULTI_DAY_LOOKBACK_DAYS)))
const dateTo = computed(() => {
  const last = new Date(year.value, month.value + 1, 0).getDate()
  return `${year.value}-${String(month.value + 1).padStart(2, '0')}-${String(last).padStart(2, '0')}`
})
const validStates = ['draft', 'confirmed', 'done', 'cancelled']
const ALL_STATES = '__all__'
const routeFilters = computed(() => parseMeetingListFilters(route.query))
const selectedState = computed(() => validStates.includes(routeFilters.value.state) ? routeFilters.value.state : '')
const projectId = computed(() => routeFilters.value.projectId)
const projectName = ref('')
const stateOptions = computed(() => [
  { value: ALL_STATES, label: t('meetingsUi.allStates') },
  ...validStates.map(code => ({ value: code, label: t(`meetingsUi.state.${code}`) })),
])
const activeFilterCount = computed(() => [selectedState.value, routeFilters.value.mine ? 'mine' : '', projectId.value].filter(Boolean).length)
function patchFilters(patch: MeetingFilterPatch) {
  void router.replace({ query: patchMeetingListQuery(route.query, patch) })
}
function onStateChange(value: unknown) {
  patchFilters({ state: value === ALL_STATES ? undefined : String(value) })
}
function onScopeChange(value: unknown) {
  patchFilters({ mine: value === 'mine' })
}
function clearFilters() {
  patchFilters({ state: undefined, mine: false, project_id: undefined })
}
const query = useMeetings(computed(() => ({
  state: selectedState.value || undefined,
  mine: routeFilters.value.mine || undefined,
  project_id: projectId.value,
  date_from: dateFrom.value,
  date_to: dateTo.value,
  limit: CALENDAR_PAGE_LIMIT,
  offset: 0,
})))
const coverage = computed(() => calendarCoverage(query.data.value?.total, CALENDAR_PAGE_LIMIT))
watch([year, month], ([nextYear, nextMonth]) => {
  const monthNumber = nextMonth + 1
  if (Number(route.query.year) === nextYear && Number(route.query.month) === monthNumber) return
  void router.replace({ query: { ...route.query, year: String(nextYear), month: String(monthNumber) } })
}, { immediate: true })
const weekStart = computed(() => (locale.value === 'ar' ? 0 : 1))

function dateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}
const rawQueryDay = firstQuery(route.query.day)
const queryDay = isCalendarDate(rawQueryDay) && rawQueryDay.startsWith(monthPrefix.value) ? rawQueryDay : null
const selectedDay = ref<string | null>(queryDay ?? (dateKey(new Date()).startsWith(monthPrefix.value) ? dateKey(new Date()) : null))
watch(selectedDay, (day) => {
  if ((route.query.day ?? null) === day) return
  const { day: _omit, ...rest } = route.query
  void router.replace({ query: day ? { ...rest, day } : rest })
})
watch([year, month], () => {
  if (selectedDay.value && !selectedDay.value.startsWith(monthPrefix.value)) selectedDay.value = null
})

const monthLabel = computed(() => new Intl.DateTimeFormat(locale.value, {
  month: 'long',
  year: 'numeric',
  calendar: 'gregory',
}).format(new Date(year.value, month.value, 1)))

const weekdayLabels = computed(() => {
  const fmt = new Intl.DateTimeFormat(locale.value, { weekday: 'short', calendar: 'gregory' })
  return Array.from({ length: 7 }, (_, index) => {
    const day = (weekStart.value + index) % 7
    return fmt.format(new Date(Date.UTC(2024, 0, 7 + day)))
  })
})

// Local calendar days a meeting covers inside the displayed month. The server filters by `meeting_date`
// (company timezone) while the days are computed in browser time, so a meeting with no usable
// start/end range, or none inside the month, falls back to its `meeting_date` when that is in the month.
function coveredDays(meeting: { meeting_date: string | null; start_datetime: string | null; end_datetime: string | null }) {
  const fallback = meeting.meeting_date?.startsWith(monthPrefix.value) ? [meeting.meeting_date] : []
  if (!meeting.start_datetime || !meeting.end_datetime) return fallback
  const start = new Date(meeting.start_datetime)
  const end = new Date(meeting.end_datetime)
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) return fallback
  const startDay = new Date(start.getFullYear(), start.getMonth(), start.getDate())
  let endDay = new Date(end.getFullYear(), end.getMonth(), end.getDate())
  const endsAtMidnight = end.getTime() === endDay.getTime()
  // Ending exactly at local midnight does not cover the day that begins there.
  if (endsAtMidnight && endDay > startDay) endDay = new Date(endDay.getFullYear(), endDay.getMonth(), endDay.getDate() - 1)
  const monthFirst = new Date(year.value, month.value, 1)
  const monthLast = new Date(year.value, month.value + 1, 0)
  const first = startDay > monthFirst ? startDay : monthFirst
  const last = endDay < monthLast ? endDay : monthLast
  const days: string[] = []
  for (let day = first; day <= last; day = new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1)) days.push(dateKey(day))
  return days.length ? days : fallback
}

const byDate = computed(() => {
  const map = new Map<string, { id: number; name: string; start_datetime: string | null; state: string }[]>()
  for (const meeting of query.data.value?.items ?? []) {
    for (const day of coveredDays(meeting)) {
      const list = map.get(day) ?? []
      list.push({ id: meeting.id, name: meeting.name, start_datetime: meeting.start_datetime, state: meeting.state })
      map.set(day, list)
    }
  }
  return map
})

const agenda = computed(() => (query.data.value?.items ?? []).filter(meeting => coveredDays(meeting).length > 0).sort((a, b) => {
  const aTime = a.start_datetime ? Date.parse(a.start_datetime) : Date.parse(`${a.meeting_date ?? '9999-12-31'}T00:00:00`)
  const bTime = b.start_datetime ? Date.parse(b.start_datetime) : Date.parse(`${b.meeting_date ?? '9999-12-31'}T00:00:00`)
  return aTime - bTime || a.id - b.id
}))

const selectedMeetings = computed(() => {
  if (!selectedDay.value) return []
  return [...(byDate.value.get(selectedDay.value) ?? [])].sort((a, b) => {
    const aTime = a.start_datetime ? Date.parse(a.start_datetime) : Number.MAX_SAFE_INTEGER
    const bTime = b.start_datetime ? Date.parse(b.start_datetime) : Number.MAX_SAFE_INTEGER
    return aTime - bTime || a.id - b.id
  })
})

function localTime(value: string | null) {
  if (!value) return ''
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return formatLocalDateTime(value)
  return hydrated.value ? formatNasqTime(parsed, locale.value) : ''
}

function localDate(value: string | null) {
  return value ? formatCalendarDate(value, locale.value) : '—'
}

const cells = computed(() => {
  const first = new Date(year.value, month.value, 1)
  const offset = (first.getDay() - weekStart.value + 7) % 7
  const days = new Date(year.value, month.value + 1, 0).getDate()
  const today = new Date()
  const todayKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
  const out: { key: string; day: number | null; today: boolean }[] = []
  for (let i = 0; i < offset; i++) out.push({ key: `p${i}`, day: null, today: false })
  for (let day = 1; day <= days; day++) {
    const key = `${year.value}-${String(month.value + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
    out.push({ key, day, today: key === todayKey })
  }
  return out
})

function shift(delta: number) {
  const next = new Date(year.value, month.value + delta, 1)
  if (next.getFullYear() < MIN_YEAR || next.getFullYear() > MAX_YEAR) return
  cursor.value = next
}

function goToday() {
  const today = new Date()
  cursor.value = new Date(today.getFullYear(), today.getMonth(), 1)
}
</script>

<template>
  <SharedTimelineFrame :title="t('nav.meetingCalendar')" :range-label="monthLabel" @prev="shift(-1)" @next="shift(1)" @today="goToday">
    <div class="grid min-w-0 gap-4">
      <FilterBar
        :title="t('filterCard.title')"
        :active-count="activeFilterCount"
        :clear-label="t('meetingsUi.clear')"
        :disabled="!hydrated"
        @clear="clearFilters"
      >
        <template #default>
          <SharedFilterChoice data-testid="meeting-state" :label="t('meetingsUi.stateLabel')" :items="stateOptions" :model-value="selectedState || ALL_STATES" :disabled="!hydrated" @update:model-value="onStateChange" />
          <SharedFilterField v-if="can('pmo.projects.read')" :label="t('meetingsFilters.project')" for="meeting-project">
            <MeetingProjectFilter id="meeting-project" hide-label class="w-full" :model-value="projectId" @update:model-value="patchFilters({ project_id: $event })" @resolved-name="projectName = $event" />
          </SharedFilterField>
        </template>
        <template #view>
          <UTabs
            data-testid="meeting-scope"
            :model-value="routeFilters.mine ? 'mine' : 'all'"
            :aria-label="t('meetingsFilters.scope')"
            :items="[{ label: t('meetingsFilters.allMeetings'), value: 'all', disabled: !hydrated }, { label: t('meetingsUi.mine'), value: 'mine', disabled: !hydrated }]"
            size="sm"
            @update:model-value="onScopeChange"
          />
        </template>
        <template v-if="activeFilterCount > 0" #active>
          <SharedFilterChip v-if="selectedState" :label="t(`meetingsUi.state.${selectedState}`)" @remove="patchFilters({ state: undefined })" />
          <SharedFilterChip v-if="routeFilters.mine" :label="t('meetingsUi.mine')" @remove="patchFilters({ mine: false })" />
          <SharedFilterChip v-if="projectId" :label="projectName || t('meetingsFilters.selectedProject')" @remove="patchFilters({ project_id: undefined })" />
        </template>
      </FilterBar>
      <p v-if="coverage.status === 'truncated'" class="text-sm text-warning" role="status">
        {{ t('meetingsUx.calendarTruncated', { count: coverage.total }, coverage.total) }}
      </p>
      <p v-else-if="coverage.status === 'unknown' && !query.isLoading.value" class="text-sm text-muted" role="status">
        {{ t('meetingsUx.calendarCoverageUnknown') }}
      </p>
      <SharedPageState :loading="query.isLoading.value" :error="query.error.value" @retry="query.refetch">
        <div class="@container min-w-0 overflow-hidden rounded-lg bg-default ring ring-default">
          <div class="@min-[600px]:hidden">
            <div v-if="!agenda.length" class="p-3"><SharedEmptyState :title="t('meetingsUi.empty')" /></div>
            <ul v-else class="grid divide-y divide-default">
              <li v-for="meeting in agenda" :key="meeting.id">
                <NuxtLink
                  :to="{ path: `/meetings/${meeting.id}`, query: returnToQuery(route.fullPath) }"
                  class="grid min-w-0 gap-1 p-3 hover:bg-elevated/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"
                >
                  <div class="flex min-w-0 items-start justify-between gap-2">
                    <span class="min-w-0 break-words font-medium text-highlighted">{{ meeting.name }}</span>
                    <SharedStatusBadge v-bind="meetingStateBadgeProps(meeting.state, t)" class="shrink-0" />
                  </div>
                  <div class="flex flex-wrap gap-x-3 gap-y-1 text-sm text-muted">
                    <span>{{ localDate(meeting.meeting_date) }}</span>
                    <span v-if="meeting.start_datetime">{{ localTime(meeting.start_datetime) }}</span>
                    <span v-else>{{ t('meetingsUx.timeUnavailable') }}</span>
                  </div>
                </NuxtLink>
              </li>
            </ul>
          </div>
          <div class="hidden @min-[600px]:grid @min-[900px]:grid-cols-[minmax(0,1fr)_18rem]">
            <div class="min-w-0 overflow-x-auto">
              <div class="min-w-[560px]">
                <div class="grid grid-cols-7 border-b border-default text-center text-xs text-muted">
                  <div v-for="label in weekdayLabels" :key="label" class="p-2">{{ label }}</div>
                </div>
                <div class="grid grid-cols-7">
                  <div
                    v-for="cell in cells"
                    :key="cell.key"
                    class="relative min-h-28 border-e border-b border-default p-1 last:border-e-0"
                    :class="[cell.today ? 'bg-primary/10' : '', cell.key === selectedDay ? 'ring-2 ring-inset ring-primary' : '']"
                  >
                    <button
                      v-if="cell.day"
                      type="button"
                      class="absolute inset-0 rounded-none hover:bg-elevated/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"
                      :disabled="!hydrated"
                      :aria-pressed="cell.key === selectedDay"
                      :aria-label="t('meetingsUx.dayCardSelect', { date: localDate(cell.key) })"
                      @click="selectedDay = cell.key"
                    />
                    <p v-if="cell.day" class="relative px-1 text-xs text-muted" aria-hidden="true">{{ cell.day }}</p>
                    <NuxtLink
                      v-for="meeting in (cell.day ? byDate.get(cell.key) ?? [] : [])"
                      :key="meeting.id"
                      :to="{ path: `/meetings/${meeting.id}`, query: returnToQuery(route.fullPath) }"
                      class="relative mt-1 block truncate rounded-md px-1 py-0.5 text-xs hover:bg-elevated focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                    >
                      <span class="block truncate text-highlighted">{{ meeting.name }}</span>
                      <span class="block truncate text-xs text-muted">
                        <span v-if="meeting.start_datetime">{{ localTime(meeting.start_datetime) }}</span>
                        <span v-else>{{ t('meetingsUx.timeUnavailable') }}</span>
                        · {{ t(`meetingsUi.state.${meeting.state}`) }}
                      </span>
                    </NuxtLink>
                  </div>
                </div>
              </div>
            </div>
            <aside class="min-w-0 border-t border-default @min-[900px]:border-s @min-[900px]:border-t-0" :aria-label="t('meetingsUx.dayCardTitle')">
              <div class="flex items-start justify-between gap-2 border-b border-default p-3">
                <div class="min-w-0">
                  <h2 class="text-sm font-semibold text-highlighted">{{ t('meetingsUx.dayCardTitle') }}</h2>
                  <p class="text-xs text-muted">{{ selectedDay ? localDate(selectedDay) : t('meetingsUx.dayCardHint') }}</p>
                </div>
                <UBadge v-if="selectedDay" color="neutral" variant="subtle" class="shrink-0">{{ t('meetingsUx.dayCardCount', { count: selectedMeetings.length }, selectedMeetings.length) }}</UBadge>
              </div>
              <div v-if="selectedDay && !selectedMeetings.length" class="p-3"><SharedEmptyState :title="t('meetingsUx.dayCardEmpty')" /></div>
              <ul v-else-if="selectedDay" class="grid gap-2 p-3">
                <li v-for="meeting in selectedMeetings" :key="meeting.id">
                  <UCard :ui="{ body: 'p-3 sm:p-3' }">
                    <div class="flex min-w-0 items-start justify-between gap-2">
                      <div class="min-w-0 grid gap-1">
                        <p class="break-words text-sm font-medium text-highlighted">{{ meeting.name }}</p>
                        <div class="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
                          <span v-if="meeting.start_datetime">{{ localTime(meeting.start_datetime) }}</span>
                          <span v-else>{{ t('meetingsUx.timeUnavailable') }}</span>
                          <SharedStatusBadge v-bind="meetingStateBadgeProps(meeting.state, t)" size="sm" />
                        </div>
                      </div>
                      <UButton
                        color="neutral"
                        variant="ghost"
                        size="sm"
                        square
                        icon="i-lucide-eye"
                        class="shrink-0"
                        :aria-label="`${t('meetingsUx.dayCardView')}: ${meeting.name}`"
                        :title="t('meetingsUx.dayCardView')"
                        :to="{ path: `/meetings/${meeting.id}`, query: returnToQuery(route.fullPath) }"
                      />
                    </div>
                  </UCard>
                </li>
              </ul>
            </aside>
          </div>
        </div>
      </SharedPageState>
    </div>
  </SharedTimelineFrame>
</template>
