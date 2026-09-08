<script setup lang="ts">
import { ChevronLeft, ChevronRight, Plus } from '@lucide/vue'
import { useMeetings } from '@/composables/useMeetings'
import { returnToQuery } from '@/utils/safeReturnTo'

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
  const map = new Map<string, { id: number; name: string }[]>()
  for (const meeting of query.data.value?.items ?? []) {
    if (!meeting.meeting_date) continue
    const list = map.get(meeting.meeting_date) ?? []
    list.push({ id: meeting.id, name: meeting.name })
    map.set(meeting.meeting_date, list)
  }
  return map
})

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
        <Button type="button" variant="ghost" size="icon" class="size-[32px] rounded-lg" :disabled="!hydrated" :aria-label="t('projects.nextPage')" @click="shift(1)">
          <ChevronLeft v-if="locale === 'ar'" class="size-[18px]" />
          <ChevronRight v-else class="size-[18px]" />
        </Button>
      </div>
    </div>
    <SharedPageState :loading="query.isLoading.value" :error="query.error.value" @retry="query.refetch">
      <div class="nasq-panel overflow-hidden">
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
              class="mt-1 block truncate rounded-md px-1 py-0.5 text-xs hover:bg-muted"
            >
              {{ meeting.name }}
            </NuxtLink>
          </div>
        </div>
      </div>
    </SharedPageState>
  </SharedPageContainer>
</template>
