<script setup lang="ts">
import type { HrShiftAssignment } from '@/composables/useHrShifts'
import FilterBar from '@liwan/ui/app/components/shared/data/FilterBar.vue'
import { ApiError } from '@/composables/useApi'
import {
  HR_SHIFTS_PAGE_SIZE,
  useDeleteHrShiftAssignment,
  useHrShiftAssignments,
  useHrShiftSchedules,
  useHrShiftSettings,
} from '@/composables/useHrShifts'
import EmployeeSearchSelect from '@/components/hr/EmployeeSearchSelect.vue'
import ShiftAssignmentTable from '@/components/hr/shifts/ShiftAssignmentTable.vue'
import { returnToQuery } from '@liwan/ui/app/utils/safeReturnTo'
import { hrShiftKpiQueries, hrShiftKpiTiles } from '@/utils/hrKpis'

const ALL = '__all__'

const route = useRoute()
const router = useRouter()
const { t } = useI18n()
const { can } = useAccess()
const hydrated = useHydrated()
const { shown: kpisShown } = useKpiVisibility()

const canRead = computed(() => can('hr.shifts.read'))
const canManage = computed(() => can('hr.shifts.manage'))
const isListRoute = computed(() => (route.path.replace(/\/+$/, '') || '/') === '/hr/shifts')

function positiveInt(value: unknown): number | null {
  const parsed = Number(Array.isArray(value) ? value[0] : value)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null
}

const offset = computed(() => Math.max(0, Number(route.query.offset ?? 0) || 0))
const employeeId = computed(() => positiveInt(route.query.employee_id))
const scheduleId = computed(() => positiveInt(route.query.schedule_id))
const onDate = computed(() => typeof route.query.on_date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(route.query.on_date)
  ? route.query.on_date
  : null)
const params = computed(() => ({
  employee_id: employeeId.value,
  schedule_id: scheduleId.value,
  on_date: onDate.value,
  limit: HR_SHIFTS_PAGE_SIZE,
  offset: offset.value,
}))

const source = useHrShiftAssignments(params)
const items = computed(() => source.data.value?.items ?? [])
const total = computed(() => source.data.value?.total ?? 0)
const page = computed(() => Math.floor(offset.value / HR_SHIFTS_PAGE_SIZE) + 1)
const pages = computed(() => Math.max(1, Math.ceil(total.value / HR_SHIFTS_PAGE_SIZE)))
const showEmpty = computed(() => !source.isLoading.value && !source.error.value && items.value.length === 0)

const schedules = useHrShiftSchedules({ active: 'true', limit: 200, offset: 0 })
const scheduleOptions = computed(() => [
  { value: ALL, label: t('hrShifts.filters.allSchedules') },
  ...(schedules.data.value?.items ?? []).map(schedule => ({ value: String(schedule.id), label: schedule.name })),
])
const activeFilterCount = computed(() => Number(Boolean(employeeId.value)) + Number(Boolean(scheduleId.value)) + Number(Boolean(onDate.value)))
const showFilters = computed(() => canRead.value)

// The tiles: every planned assignment, and the ones running on the company's calendar day. The planned tile reuses the
// unfiltered list's own total; the day's tile needs the shift settings' day and asks only once it has arrived.
const kpisEnabled = computed(() => canRead.value && kpisShown.value)
const settings = useHrShiftSettings(kpisEnabled)
const today = computed(() => settings.data.value?.today ?? '')
const kpiQueries = computed(() => hrShiftKpiQueries(today.value))
const listFiltered = computed(() => activeFilterCount.value > 0)
const plannedKpi = useHrShiftAssignments(computed(() => kpiQueries.value.planned), computed(() => kpisEnabled.value && listFiltered.value))
const todayKpi = useHrShiftAssignments(computed(() => kpiQueries.value.today), computed(() => kpisEnabled.value && !!today.value))
const kpiTiles = computed(() => hrShiftKpiTiles({
  planned: listFiltered.value ? plannedKpi.data.value?.total ?? null : source.data.value?.total ?? null,
  today: today.value ? todayKpi.data.value?.total ?? null : undefined,
}, today.value, t))
const kpiLoading = computed(() => (listFiltered.value ? plannedKpi.isLoading.value : !source.data.value && !source.error.value) || todayKpi.isLoading.value)

function writeQuery(next: { employee_id?: number | null; schedule_id?: number | null; on_date?: string | null; offset?: number }) {
  const nextEmployee = next.employee_id === undefined ? employeeId.value : next.employee_id
  const nextSchedule = next.schedule_id === undefined ? scheduleId.value : next.schedule_id
  const nextDate = next.on_date === undefined ? onDate.value : next.on_date
  const nextOffset = next.offset ?? 0
  void router.replace({
    query: {
      ...route.query,
      employee_id: nextEmployee ?? undefined,
      schedule_id: nextSchedule ?? undefined,
      on_date: nextDate ?? undefined,
      offset: nextOffset > 0 ? nextOffset : undefined,
    },
    hash: route.hash,
  })
}

function pickSchedule(value: unknown) {
  writeQuery({ schedule_id: value && value !== ALL ? Number(value) : null, offset: 0 })
}

function pickDate(value: string | null) {
  writeQuery({ on_date: value, offset: 0 })
}

function clearFilters() {
  writeQuery({ employee_id: null, schedule_id: null, on_date: null, offset: 0 })
}

function setPage(next: number) {
  if (!hydrated.value || source.isFetching.value || next < 1 || next > pages.value) return
  writeQuery({ offset: (next - 1) * HR_SHIFTS_PAGE_SIZE })
}

const listQuery = computed(() => {
  const { returnTo: _referrer, ...rest } = route.query
  return rest
})
const createTo = computed(() => canManage.value && canRead.value
  ? { path: '/hr/shifts/new', query: listQuery.value, ...(route.hash ? { hash: route.hash } : {}) }
  : undefined)
const schedulesTo = computed(() => ({ path: '/hr/shifts/schedules', query: listQuery.value, ...(route.hash ? { hash: route.hash } : {}) }))

function assignmentTo(assignment: HrShiftAssignment) {
  return { path: `/hr/shifts/assignments/${assignment.id}`, query: returnToQuery(route.fullPath) }
}

const removing = ref<HrShiftAssignment | null>(null)
const removeError = ref('')
const { mutateAsync: deleteAssignment, isPending: removingPending } = useDeleteHrShiftAssignment()

async function confirmRemove() {
  if (!removing.value || !hydrated.value || removingPending.value) return
  removeError.value = ''
  try {
    await deleteAssignment(removing.value.id)
    removing.value = null
  } catch (cause) {
    removeError.value = cause instanceof ApiError ? cause.message : t('errors.generic')
  }
}
</script>

<template>
  <SharedListPage
    v-if="isListRoute"
    :title="t('hrShifts.title')"
    :create-to="createTo"
    :create-label="t('hrShifts.new')"
    create-test-id="hr-shifts-new"
  >
    <template v-if="canRead" #actions>
      <UButton
        color="neutral"
        variant="outline"
        icon="i-lucide-calendar-clock"
        :to="schedulesTo"
        :disabled="!hydrated"
        :label="t('hrShifts.schedules')"
        data-testid="hr-shifts-schedules-link"
      />
      <UButton
        color="neutral"
        variant="outline"
        icon="i-lucide-calendar-days"
        :to="{ path: '/hr/shifts/roster' }"
        :disabled="!hydrated"
        :label="t('hrShifts.week')"
        data-testid="hr-shifts-roster-link"
      />
    </template>

    <template v-if="canRead" #kpis>
      <SharedKpiStrip :tiles="kpiTiles" :loading="kpiLoading" :skeleton-count="2" :label="t('hrShifts.kpi.label')" data-testid="hr-shifts-kpis" />
    </template>

    <div class="liwan-page-stack">
      <UAlert v-if="removeError" role="alert" color="error" variant="subtle" :title="removeError" data-testid="hr-shifts-remove-error" />
      <SharedInlineConfirm
        v-if="removing"
        :title="t('hrShifts.removeConfirm', { name: removing.employee.name })"
        :confirm-label="t('hrShifts.remove')"
        :cancel-label="t('app.back')"
        :pending="removingPending"
        :disabled="!hydrated"
        color="error"
        @confirm="confirmRemove"
        @cancel="removing = null"
      />

      <SharedListCard>
        <template v-if="showFilters" #filters>
          <FilterBar
            embedded
            :title="t('hrShifts.filters.title')"
            :active-count="activeFilterCount"
            :disabled="!hydrated"
            @clear="clearFilters"
          >
            <SharedFilterField :label="t('hrShifts.filters.employee')" for="hr-shifts-filter-employee">
              <EmployeeSearchSelect
                id="hr-shifts-filter-employee"
                :model-value="employeeId"
                :any-label="t('hrShifts.filters.allEmployees')"
                :placeholder="t('hrShifts.filters.allEmployees')"
                :disabled="!hydrated"
                test-id="hr-shifts-filter-employee"
                @update:model-value="writeQuery({ employee_id: $event, offset: 0 })"
              />
            </SharedFilterField>
            <SharedFilterField :label="t('hrShifts.filters.schedule')" for="hr-shifts-filter-schedule">
              <USelect
                id="hr-shifts-filter-schedule"
                class="w-full"
                :model-value="scheduleId ? String(scheduleId) : ALL"
                :items="scheduleOptions"
                :disabled="!hydrated"
                data-testid="hr-shifts-filter-schedule"
                @update:model-value="pickSchedule"
              />
            </SharedFilterField>
            <SharedFilterField :label="t('hrShifts.filters.onDate')" for="hr-shifts-filter-date">
              <SharedDateField
                id="hr-shifts-filter-date"
                :model-value="onDate"
                :aria-label="t('hrShifts.filters.onDate')"
                :disabled="!hydrated"
                data-testid="hr-shifts-filter-date"
                @update:model-value="pickDate"
              />
            </SharedFilterField>
          </FilterBar>
        </template>

        <SharedPageState :error="source.error.value" :keep-content="items.length > 0" @retry="source.refetch">
          <SharedEmptyState icon="i-lucide-calendar-clock"
            v-if="showEmpty"
            class="m-(--liwan-card-pad-dense)"
            :title="t('hrShifts.empty')"
            :description="t('hrShifts.emptyHint')"
          />
          <ShiftAssignmentTable
            v-else
            :assignments="items"
            :caption="t('hrShifts.title')"
            :loading="source.isLoading.value"
            :can-manage="canManage"
            :row-to="assignmentTo"
            @remove="removing = $event"
            @retry="source.refetch"
          />
        </SharedPageState>
        <template v-if="source.data.value && !showEmpty" #footer>
          <SharedListFooter
            :count-label="t('hrShifts.footer', { shown: items.length, total }, total)"
            :page="page"
            :pages="pages"
            :disabled="source.isFetching.value"
            count-test-id="hr-shifts-count"
            @update:page="setPage"
          />
        </template>
      </SharedListCard>
    </div>
  </SharedListPage>
  <NuxtPage />
</template>
