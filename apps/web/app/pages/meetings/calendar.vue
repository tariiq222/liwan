<script setup lang="ts">
import { useMeetings } from '@/composables/useMeetings'
import { returnToQuery } from '@/utils/safeReturnTo'
import { formatCalendarDate, formatNasqTime } from '@/composables/calendarDate'
import { formatLocalDateTime } from '@/utils/meetingDateTime'
import { calendarCoverage } from '@/utils/meetingWorkspace'
import { meetingStateBadgeProps } from '@/utils/meetingStatus'

const route = useRoute()
const router = useRouter()
const { t, locale } = useI18n()
const hydrated = useHydrated()
const queryYear = Number(route.query.year)
const queryMonth = Number(route.query.month)
const cursor = ref(new Date(
  Number.isInteger(queryYear) ? queryYear : new Date().getFullYear(),
  Number.isInteger(queryMonth) && queryMonth >= 1 && queryMonth <= 12 ? queryMonth - 1 : new Date().getMonth(),
  1,
))
const year = computed(() => cursor.value.getFullYear())
const month = computed(() => cursor.value.getMonth())
const dateFrom = computed(() => `${year.value}-${String(month.value + 1).padStart(2, '0')}-01`)
const dateTo = computed(() => {
  const last = new Date(year.value, month.value + 1, 0).getDate()
  return `${year.value}-${String(month.value + 1).padStart(2, '0')}-${String(last).padStart(2, '0')}`
})
const query = useMeetings(computed(() => ({
  date_from: dateFrom.value,
  date_to: dateTo.value,
  limit: 2000,
  offset: 0,
})))
const coverage = computed(() => calendarCoverage(query.data.value?.total, 2000))
watch([year, month], ([nextYear, nextMonth]) => {
  const monthNumber = nextMonth + 1
  if (Number(route.query.year) === nextYear && Number(route.query.month) === monthNumber) return
  void router.replace({ query: { ...route.query, year: String(nextYear), month: String(monthNumber) } })
}, { immediate: true })
const weekStart = computed(() => (locale.value === 'ar' ? 6 : 1))

function dateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}
const queryDay = typeof route.query.day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(route.query.day) ? route.query.day : null
const selectedDay = ref<string | null>(queryDay ?? (dateKey(new Date()).startsWith(dateFrom.value.slice(0, 7)) ? dateKey(new Date()) : null))
watch(selectedDay, (day) => {
  if ((route.query.day ?? null) === day) return
  const { day: _omit, ...rest } = route.query
  void router.replace({ query: day ? { ...rest, day } : rest })
})
watch([year, month], () => {
  if (selectedDay.value && !selectedDay.value.startsWith(dateFrom.value.slice(0, 7))) selectedDay.value = null
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

const byDate = computed(() => {
  const map = new Map<string, { id: number; name: string; start_datetime: string | null; state: string }[]>()
  for (const meeting of query.data.value?.items ?? []) {
    if (!meeting.meeting_date) continue
    const list = map.get(meeting.meeting_date) ?? []
    list.push({ id: meeting.id, name: meeting.name, start_datetime: meeting.start_datetime, state: meeting.state })
    map.set(meeting.meeting_date, list)
  }
  return map
})

const agenda = computed(() => [...(query.data.value?.items ?? [])].sort((a, b) => {
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
  return formatNasqTime(parsed, locale.value)
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
  cursor.value = new Date(year.value, month.value + delta, 1)
}

function goToday() {
  const today = new Date()
  cursor.value = new Date(today.getFullYear(), today.getMonth(), 1)
}
</script>

<template>
  <SharedTimelineFrame :title="t('nav.meetingCalendar')" :range-label="monthLabel" @prev="shift(-1)" @next="shift(1)" @today="goToday">
    <div class="grid min-w-0 gap-4">
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
