<script setup lang="ts">
import FilterBar from '@webvue/ui/app/components/shared/data/FilterBar.vue'
import MeetingProjectFilter from '@/components/meetings/MeetingProjectFilter.vue'
import { useMeetings } from '@/composables/useMeetings'
import { returnToQuery } from '@webvue/ui/app/utils/safeReturnTo'
import { formatCalendarDate, formatWebVueTime, isCalendarDate } from '@webvue/ui/app/composables/calendarDate'
import { formatLocalDateTime } from '@/utils/meetingDateTime'
import { parseMeetingListFilters, patchMeetingListQuery, type MeetingFilterPatch } from '@/utils/meetingListFilters'
import { calendarCoverage } from '@/utils/meetingWorkspace'
import { meetingStateBadge, meetingStateBadgeProps } from '@/utils/meetingStatus'
import { meetingViewRoute, meetingViewOptions } from '@/utils/meetingRoutes'
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
const activeFilterCount = computed(() => [routeFilters.value.q, routeFilters.value.organizerId, routeFilters.value.seriesId, selectedState.value, routeFilters.value.mine ? 'mine' : '', projectId.value].filter(Boolean).length)
function patchFilters(patch: MeetingFilterPatch) {
  void router.replace({ query: patchMeetingListQuery(route.query, patch) })
}
function onStateChange(value: unknown) {
  patchFilters({ state: value === ALL_STATES ? undefined : String(value) })
}
const scopeItems = computed(() => [
  { value: 'all', label: t('meetingsFilters.allMeetings') },
  { value: 'mine', label: t('meetingsUi.mine') },
])
function onScopeChange(value: unknown) {
  patchFilters({ mine: value === 'mine' })
}
// The tone dot of an event chip, from the same tone map as the state pill.
const STATE_DOT: Record<string, string> = { neutral: 'bg-accented', info: 'bg-info', success: 'bg-success', warning: 'bg-warning', destructive: 'bg-error', primary: 'bg-primary' }
function stateDot(state: string) {
  return STATE_DOT[meetingStateBadge(state).tone] ?? 'bg-accented'
}
function chipTitle(meeting: { name: string; start_datetime: string | null; state: string }) {
  return [meeting.name, meeting.start_datetime ? localTime(meeting.start_datetime) : t('meetingsUx.timeUnavailable'), t(`meetingsUi.state.${meeting.state}`)].join(' · ')
}
function clearFilters() {
  patchFilters({ q: undefined, organizer_id: undefined, series_id: undefined, state: undefined, mine: false, project_id: undefined })
}
const query = useMeetings(computed(() => ({
  q: routeFilters.value.q || undefined,
  organizer_id: routeFilters.value.organizerId,
  series_id: routeFilters.value.seriesId,
  state: selectedState.value || undefined,
  mine: routeFilters.value.mine || undefined,
  project_id: projectId.value,
  date_from: dateFrom.value,
  date_to: dateTo.value,
  limit: CALENDAR_PAGE_LIMIT,
  offset: 0,
})))
const coverage = computed(() => calendarCoverage(query.data.value?.total, CALENDAR_PAGE_LIMIT))
const weekStart = computed(() => (locale.value === 'ar' ? 0 : 1))

function dateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}
const rawQueryDay = firstQuery(route.query.day)
const queryDay = isCalendarDate(rawQueryDay) && rawQueryDay.startsWith(monthPrefix.value) ? rawQueryDay : null
const selectedDay = ref<string | null>(queryDay ?? (dateKey(new Date()).startsWith(monthPrefix.value) ? dateKey(new Date()) : null))
watch([year, month, selectedDay], ([nextYear, nextMonth, day]) => {
  const monthNumber = nextMonth + 1
  if (Number(route.query.year) === nextYear && Number(route.query.month) === monthNumber && (firstQuery(route.query.day) ?? null) === day) return
  void router.replace({ query: { ...route.query, year: String(nextYear), month: String(monthNumber), day: day ?? undefined } })
}, { immediate: true })
watch(() => [route.query.year, route.query.month, route.query.day], ([yearQuery, monthQuery, dayQuery]) => {
  const nextYear = Number(firstQuery(yearQuery))
  const nextMonth = Number(firstQuery(monthQuery))
  if (!Number.isInteger(nextYear) || nextYear < MIN_YEAR || nextYear > MAX_YEAR || !Number.isInteger(nextMonth) || nextMonth < 1 || nextMonth > 12) return
  if (year.value !== nextYear || month.value !== nextMonth - 1) cursor.value = new Date(nextYear, nextMonth - 1, 1)
  const day = firstQuery(dayQuery)
  selectedDay.value = isCalendarDate(day) && day.startsWith(monthPrefix.value) ? day : null
})

const createTo = computed(() => ({ path: '/meetings/new', query: { ...returnToQuery(route.fullPath), ...(selectedDay.value ? { date: selectedDay.value } : {}), ...(projectId.value ? { project_id: String(projectId.value) } : {}), ...(routeFilters.value.seriesId ? { series_id: String(routeFilters.value.seriesId) } : {}) } }))

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
  return hydrated.value ? formatWebVueTime(parsed, locale.value) : ''
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
  selectedDay.value = null
  cursor.value = next
}

function goToday() {
  const today = new Date()
  cursor.value = new Date(today.getFullYear(), today.getMonth(), 1)
  selectedDay.value = dateKey(today)
}
</script>

<template>
  <SharedTimelineFrame :title="t('nav.meetings')" :range-label="monthLabel" @prev="shift(-1)" @next="shift(1)" @today="goToday">
    <template #actions><UButton v-if="can('meetings.create')" icon="i-lucide-plus" :to="createTo" :label="t('nav.newMeeting')" data-testid="meeting-calendar-new" /></template>
    <div class="grid min-w-0">
      <div class="border-b border-default px-(--webvue-card-pad-dense) py-3">
        <FilterBar embedded class="w-full" :active-count="activeFilterCount" :clear-label="t('meetingsUi.clear')" :disabled="!hydrated" @clear="clearFilters">
          <template #search>
            <UInput :model-value="routeFilters.q" class="w-full" icon="i-lucide-search" :placeholder="t('meetingsFilters.searchMeetings')" :aria-label="t('meetingsFilters.searchMeetings')" :disabled="!hydrated" @update:model-value="patchFilters({ q: String($event) || undefined })">
              <template v-if="routeFilters.q" #trailing>
                <UButton type="button" color="neutral" variant="link" size="sm" icon="i-lucide-x" :aria-label="t('meetingsFilters.clearSearch')" class="-me-1" @click="patchFilters({ q: undefined })" />
              </template>
            </UInput>
          </template>
          <template #default>
            <USelect data-testid="meeting-state" class="w-full md:w-44" icon="i-lucide-activity" :items="stateOptions" :model-value="selectedState || ALL_STATES" :disabled="!hydrated" :aria-label="t('meetingsUi.stateLabel')" @update:model-value="onStateChange" />
            <MeetingProjectFilter v-if="can('pmo.projects.read')" id="meeting-project" hide-label class="w-full md:w-44" :model-value="projectId" @update:model-value="patchFilters({ project_id: $event })" @resolved-name="projectName = $event" />
          </template>
          <template #view>
            <SharedSegmentedControl data-testid="meeting-scope" :label="t('meetingsFilters.scope')" :items="scopeItems" :model-value="routeFilters.mine ? 'mine' : 'all'" :disabled="!hydrated" @update:model-value="onScopeChange" />
            <SharedViewSwitch model-value="calendar" :options="meetingViewOptions(t)" @update:model-value="value => router.push(meetingViewRoute(route.query, value === 'calendar' ? 'calendar' : 'list'))" />
          </template>
          <!-- The dropdowns show their own choice; only the filters inherited from a link have no control. -->
          <template v-if="routeFilters.organizerId || routeFilters.seriesId" #active>
            <SharedFilterChip v-if="routeFilters.organizerId" :label="t('meetingsFilters.selectedOrganizer')" @remove="patchFilters({ organizer_id: undefined })" />
            <SharedFilterChip v-if="routeFilters.seriesId" :label="t('meetingsFilters.inheritedSeries')" @remove="patchFilters({ series_id: undefined })" />
          </template>
        </FilterBar>
      </div>
      <p v-if="coverage.status === 'truncated'" class="px-(--webvue-card-pad-dense) py-3 text-sm text-warning" role="status">
        {{ t('meetingsUx.calendarTruncated', { count: coverage.total }, coverage.total) }}
      </p>
      <p v-else-if="coverage.status === 'unknown' && !query.isLoading.value" class="px-(--webvue-card-pad-dense) py-3 text-sm text-muted" role="status">
        {{ t('meetingsUx.calendarCoverageUnknown') }}
      </p>
      <SharedPageState :loading="query.isLoading.value" :error="query.error.value" @retry="query.refetch">
        <div class="@container min-w-0">
          <div class="@xl:hidden">
            <div v-if="!agenda.length" class="p-(--webvue-card-pad-dense)"><SharedEmptyState :title="t('meetingsUi.empty')" /></div>
            <ul v-else class="grid divide-y divide-default">
              <li v-for="meeting in agenda" :key="meeting.id">
                <NuxtLink
                  :to="{ path: `/meetings/${meeting.id}`, query: returnToQuery(route.fullPath) }"
                  class="grid min-w-0 gap-1 px-(--webvue-card-pad-dense) py-3 hover:bg-(--webvue-row-hover) focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"
                >
                  <div class="flex min-w-0 items-start justify-between gap-2">
                    <span class="min-w-0 break-words font-semibold text-highlighted">{{ meeting.name }}</span>
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
          <div class="hidden @xl:grid @4xl:grid-cols-[minmax(0,1fr)_18rem]">
            <div class="min-w-0 overflow-x-auto">
              <div class="min-w-[calc(var(--webvue-row-h)*14)]">
                <div class="grid grid-cols-7 border-b border-default bg-muted text-center text-xs font-medium text-muted">
                  <div v-for="label in weekdayLabels" :key="label" class="py-2">{{ label }}</div>
                </div>
                <div class="grid grid-cols-7">
                  <div
                    v-for="cell in cells"
                    :key="cell.key"
                    class="relative grid min-h-[calc(var(--webvue-row-h)*3)] content-start gap-1 border-e border-b border-default p-(--webvue-subcard-pad) last:border-e-0"
                    :class="{ 'ring-2 ring-inset ring-primary': cell.key === selectedDay }"
                  >
                    <button
                      v-if="cell.day"
                      type="button"
                      class="absolute inset-0 hover:bg-(--webvue-row-hover) focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"
                      :disabled="!hydrated"
                      :aria-pressed="cell.key === selectedDay"
                      :aria-label="t('meetingsUx.dayCardSelect', { date: localDate(cell.key) })"
                      @click="selectedDay = cell.key"
                    />
                    <span
                      v-if="cell.day"
                      class="pointer-events-none relative inline-flex size-6 items-center justify-center rounded-full text-xs tabular-nums"
                      :class="cell.today ? 'bg-primary/15 font-semibold text-primary' : 'text-muted'"
                      :aria-current="cell.today ? 'date' : undefined"
                      aria-hidden="true"
                    >{{ cell.day }}</span>
                    <NuxtLink
                      v-for="meeting in (cell.day ? byDate.get(cell.key) ?? [] : [])"
                      :key="meeting.id"
                      :to="{ path: `/meetings/${meeting.id}`, query: returnToQuery(route.fullPath) }"
                      :title="chipTitle(meeting)"
                      class="relative flex min-w-0 items-center gap-1.5 rounded-full bg-elevated px-2 py-0.5 text-xs text-highlighted hover:bg-accented focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                    >
                      <span class="size-1.5 shrink-0 rounded-full" :class="stateDot(meeting.state)" aria-hidden="true" />
                      <span class="truncate">{{ meeting.name }}</span>
                      <span class="sr-only">{{ meeting.start_datetime ? localTime(meeting.start_datetime) : t('meetingsUx.timeUnavailable') }} · {{ t(`meetingsUi.state.${meeting.state}`) }}</span>
                    </NuxtLink>
                  </div>
                </div>
              </div>
            </div>
            <aside class="min-w-0 border-t border-default p-(--webvue-card-pad-dense) @4xl:border-s @4xl:border-t-0" :aria-label="t('meetingsUx.dayCardTitle')">
              <SharedRecordSection variant="list" :title="t('meetingsUx.dayCardTitle')" :description="selectedDay ? localDate(selectedDay) : t('meetingsUx.dayCardHint')">
                <template v-if="selectedDay" #actions><UBadge color="neutral" variant="subtle" class="shrink-0">{{ t('meetingsUx.dayCardCount', { count: selectedMeetings.length }, selectedMeetings.length) }}</UBadge></template>
                <p v-if="selectedDay && !selectedMeetings.length" class="px-(--webvue-card-pad) py-4 text-sm text-muted">{{ t('meetingsUx.dayCardEmpty') }}</p>
                <div v-for="meeting in selectedMeetings" :key="meeting.id" class="flex min-w-0 items-start justify-between gap-2 px-(--webvue-card-pad) py-3">
                  <div class="grid min-w-0 gap-1">
                    <NuxtLink :to="{ path: `/meetings/${meeting.id}`, query: returnToQuery(route.fullPath) }" class="break-words text-sm font-semibold text-highlighted hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">{{ meeting.name }}</NuxtLink>
                    <div class="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
                      <span v-if="meeting.start_datetime">{{ localTime(meeting.start_datetime) }}</span>
                      <span v-else>{{ t('meetingsUx.timeUnavailable') }}</span>
                      <SharedStatusBadge v-bind="meetingStateBadgeProps(meeting.state, t)" size="sm" />
                    </div>
                  </div>
                </div>
              </SharedRecordSection>
            </aside>
          </div>
        </div>
      </SharedPageState>
    </div>
  </SharedTimelineFrame>
</template>
