<script setup lang="ts">
import { ChevronLeft, ChevronRight, Plus } from '@lucide/vue'
import { useMeetings } from '@/composables/useMeetings'
import { returnToQuery } from '@/utils/safeReturnTo'
import { formatCalendarDate } from '@/composables/calendarDate'
import { formatLocalDateTime } from '@/utils/meetingDateTime'
import { calendarCoverage } from '@/utils/meetingWorkspace'

const route = useRoute()
const router = useRouter()
const { t, locale } = useI18n()
const hydrated = useHydrated()
const { can } = useAccess()
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

function localTime(value: string | null) {
  if (!value) return ''
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return formatLocalDateTime(value)
  return new Intl.DateTimeFormat(locale.value, { timeStyle: 'short', calendar: 'gregory' }).format(parsed)
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
  <SharedPageContainer width="list">
    <SharedPageHeader :title="t('nav.meetingCalendar')" :back-to="'/meetings'">
      <template #actions>
        <NuxtLink v-if="can('meetings.create')" :to="{ path: '/meetings/new', query: returnToQuery(route.fullPath) }">
          <Button :disabled="!hydrated" class="gap-2">
            <Plus class="size-[18px]" />{{ t('meetingsUi.new') }}
          </Button>
        </NuxtLink>
      </template>
    </SharedPageHeader>
    <div class="nasq-toolbar">
      <div class="flex items-center gap-2" :aria-label="monthLabel">
        <Button type="button" variant="ghost" size="icon" class="size-[32px] rounded-lg" :disabled="!hydrated" :aria-label="t('projects.previousPage')" @click="shift(-1)">
          <ChevronRight v-if="locale === 'ar'" class="size-[18px]" />
          <ChevronLeft v-else class="size-[18px]" />
        </Button>
        <span class="min-w-40 text-center text-sm font-medium">{{ monthLabel }}</span>
        <Button type="button" variant="outline" size="sm" :disabled="!hydrated" @click="goToday">{{ t('meetingsUx.today') }}</Button>
        <Button type="button" variant="ghost" size="icon" class="size-[32px] rounded-lg" :disabled="!hydrated" :aria-label="t('projects.nextPage')" @click="shift(1)">
          <ChevronLeft v-if="locale === 'ar'" class="size-[18px]" />
          <ChevronRight v-else class="size-[18px]" />
        </Button>
      </div>
    </div>
    <p v-if="coverage.status === 'truncated'" class="text-sm nasq-status-text-warning" role="status">
      {{ t('meetingsUx.calendarTruncated', { count: coverage.total }) }}
    </p>
    <p v-else-if="coverage.status === 'unknown' && !query.isLoading.value" class="text-sm text-muted-foreground" role="status">
      {{ t('meetingsUx.calendarCoverageUnknown') }}
    </p>
    <SharedPageState :loading="query.isLoading.value" :error="query.error.value" @retry="query.refetch">
      <div class="nasq-panel overflow-hidden">
        <div class="md:hidden">
          <div v-if="!agenda.length" class="p-4 text-sm text-muted-foreground">{{ t('meetingsUi.empty') }}</div>
          <NuxtLink
            v-for="meeting in agenda"
            :key="meeting.id"
            :to="{ path: `/meetings/${meeting.id}`, query: returnToQuery(route.fullPath) }"
            class="grid min-w-0 gap-1 border-b border-border p-3 last:border-0 hover:bg-muted/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <div class="flex min-w-0 items-start justify-between gap-2">
              <span class="min-w-0 break-words font-medium">{{ meeting.name }}</span>
              <Badge variant="secondary" class="shrink-0">{{ t(`meetingsUi.state.${meeting.state}`) }}</Badge>
            </div>
            <div class="flex flex-wrap gap-x-3 gap-y-1 text-sm text-muted-foreground">
              <span>{{ localDate(meeting.meeting_date) }}</span>
              <span v-if="meeting.start_datetime">{{ localTime(meeting.start_datetime) }}</span>
              <span v-else>{{ t('meetingsUx.timeUnavailable') }}</span>
            </div>
          </NuxtLink>
        </div>
        <div class="hidden overflow-x-auto md:block">
          <div class="min-w-[560px]">
            <div class="grid grid-cols-7 border-b border-border text-center text-xs text-muted-foreground">
              <div v-for="label in weekdayLabels" :key="label" class="p-2">{{ label }}</div>
            </div>
            <div class="grid grid-cols-7">
              <div v-for="cell in cells" :key="cell.key" class="min-h-28 border-e border-b border-border p-1 last:border-e-0" :class="cell.today ? 'bg-brand-soft' : ''">
                <p v-if="cell.day" class="px-1 text-xs text-muted-foreground">{{ cell.day }}</p>
                <NuxtLink
                  v-for="meeting in (cell.day ? byDate.get(cell.key) ?? [] : [])"
                  :key="meeting.id"
                  :to="{ path: `/meetings/${meeting.id}`, query: returnToQuery(route.fullPath) }"
                  class="mt-1 block truncate rounded-md px-1 py-0.5 text-xs hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span class="block truncate">{{ meeting.name }}</span>
                  <span class="block truncate text-[11px] text-muted-foreground">
                    <span v-if="meeting.start_datetime">{{ localTime(meeting.start_datetime) }}</span>
                    <span v-else>{{ t('meetingsUx.timeUnavailable') }}</span>
                    · {{ t(`meetingsUi.state.${meeting.state}`) }}
                  </span>
                </NuxtLink>
              </div>
            </div>
          </div>
        </div>
      </div>
    </SharedPageState>
  </SharedPageContainer>
</template>
