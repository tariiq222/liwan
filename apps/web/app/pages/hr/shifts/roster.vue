<script setup lang="ts">
import { ApiError } from '@/composables/useApi'
import { HR_SHIFTS_PAGE_SIZE, useHrShiftRoster, useHrShiftSettings, useHrShiftSchedules, useSetHrShiftWeek } from '@/composables/useHrShifts'
import ShiftWeekGrid from '@/components/hr/shifts/ShiftWeekGrid.vue'
import { addWeeks, isIsoDate, weekStartOf } from '@/components/hr/shifts/shiftWeek'

const route = useRoute()
const router = useRouter()
const { t } = useI18n()
const { can } = useAccess()
const hydrated = useHydrated()
const canManage = computed(() => can('hr.shifts.manage'))

// "Today" is the company's calendar day (the shift settings), not the browser's or UTC's.
const settings = useHrShiftSettings()
const todayWeek = computed(() => (settings.data.value ? weekStartOf(settings.data.value.today) : ''))
const weekStart = computed(() => {
  const asked = Array.isArray(route.query.week_start) ? route.query.week_start[0] : route.query.week_start
  return isIsoDate(asked) ? asked : todayWeek.value
})
const offset = computed(() => Math.max(0, Number(route.query.offset ?? 0) || 0))

const roster = useHrShiftRoster(weekStart, offset)
const weeks = computed(() => roster.data.value?.items ?? [])
const total = computed(() => roster.data.value?.total ?? 0)
const page = computed(() => Math.floor(offset.value / HR_SHIFTS_PAGE_SIZE) + 1)
const pages = computed(() => Math.max(1, Math.ceil(total.value / HR_SHIFTS_PAGE_SIZE)))
const schedules = useHrShiftSchedules({ active: 'true', limit: 200, offset: 0 })
const scheduleList = computed(() => (canManage.value ? schedules.data.value?.items ?? [] : undefined))

function go(query: Record<string, string | undefined>) {
  if (!hydrated.value) return
  void router.replace({ query: { ...route.query, ...query }, hash: route.hash })
}
function goWeek(weeks: number) {
  if (weekStart.value) go({ week_start: addWeeks(weekStart.value, weeks), offset: undefined })
}
const goToday = () => go({ week_start: undefined, offset: undefined })
const setPage = (next: number) => {
  if (roster.isFetching.value || next < 1 || next > pages.value) return
  go({ offset: next > 1 ? String((next - 1) * HR_SHIFTS_PAGE_SIZE) : undefined })
}

const { mutateAsync: setWeek, isPending } = useSetHrShiftWeek()
const saved = ref(false)
const error = ref('')

async function applyWeek(employeeId: number, scheduleId: number) {
  if (!hydrated.value || isPending.value) return
  error.value = ''
  saved.value = false
  try {
    await setWeek({ employee_id: employeeId, schedule_id: scheduleId, week_start: weekStart.value })
    saved.value = true
  } catch (cause) {
    error.value = cause instanceof ApiError ? cause.message : t('errors.generic')
  }
}
</script>

<template>
  <SharedListPage :title="t('hrShifts.weekTitle')" :back-to="{ path: '/hr/shifts' }" :back-label="t('hrShifts.title')">
    <template #actions>
      <UButton color="neutral" variant="outline" icon="i-lucide-chevron-right" :label="t('hrShifts.prevWeek')" :disabled="!hydrated" @click="goWeek(-1)" />
      <UButton color="neutral" variant="outline" :label="t('hrShifts.thisWeek')" :disabled="!hydrated" @click="goToday" />
      <UButton color="neutral" variant="outline" trailing-icon="i-lucide-chevron-left" :label="t('hrShifts.nextWeek')" :disabled="!hydrated" @click="goWeek(1)" />
    </template>
    <div class="liwan-page-stack">
      <p class="text-sm text-muted">{{ t('hrShifts.weekOf', { date: weekStart }) }}</p>
      <UAlert v-if="error" role="alert" color="error" variant="subtle" :title="error" />
      <UAlert v-else-if="saved" role="status" color="success" variant="subtle" :title="t('hrShifts.weekSaved')" />
      <SharedListCard>
        <SharedPageState :loading="roster.isLoading.value" :error="roster.error.value" :keep-content="weeks.length > 0" @retry="roster.refetch">
          <SharedEmptyState v-if="!weeks.length" class="m-(--liwan-card-pad-dense)" :title="t('hrShifts.weekEmpty')" />
          <ShiftWeekGrid
            v-else
            :weeks="weeks"
            :caption="t('hrShifts.weekTitle')"
            :schedules="scheduleList"
            :busy="isPending"
            @set="applyWeek"
          />
        </SharedPageState>
        <template v-if="pages > 1" #footer>
          <UPagination :page="page" :total="total" :items-per-page="HR_SHIFTS_PAGE_SIZE" @update:page="setPage" />
        </template>
      </SharedListCard>
    </div>
  </SharedListPage>
</template>
