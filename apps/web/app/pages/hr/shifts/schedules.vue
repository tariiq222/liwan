<script setup lang="ts">
import type { HrShiftSchedule } from '@/composables/useHrShifts'
import { ApiError } from '@/composables/useApi'
import {
  HR_SHIFTS_PAGE_SIZE,
  useArchiveHrShiftSchedule,
  useHrShiftSchedules,
  type HrShiftScheduleActive,
} from '@/composables/useHrShifts'
import ShiftScheduleTable from '@/components/hr/shifts/ShiftScheduleTable.vue'

const route = useRoute()
const router = useRouter()
const { t } = useI18n()
const { can } = useAccess()
const hydrated = useHydrated()

const canManage = computed(() => can('hr.shifts.manage'))
// The schedule record and its create panel are children of this route; only the list
// itself renders here, so `/hr/shifts/schedules/<id>` opens one page, not two.
const isListRoute = computed(() => (route.path.replace(/\/+$/, '') || '/') === '/hr/shifts/schedules')
const activeFilter = computed<HrShiftScheduleActive>(() => {
  const asked = Array.isArray(route.query.active) ? route.query.active[0] : route.query.active
  return asked === 'false' || asked === 'all' ? asked : 'true'
})
const offset = computed(() => Math.max(0, Number(route.query.offset ?? 0) || 0))
const params = computed(() => ({ active: activeFilter.value, limit: HR_SHIFTS_PAGE_SIZE, offset: offset.value }))
const query = useHrShiftSchedules(params)

const schedules = computed(() => query.data.value?.items ?? [])
const total = computed(() => query.data.value?.total ?? 0)
const page = computed(() => Math.floor(offset.value / HR_SHIFTS_PAGE_SIZE) + 1)
const pages = computed(() => Math.max(1, Math.ceil(total.value / HR_SHIFTS_PAGE_SIZE)))
const showEmpty = computed(() => !query.isLoading.value && !query.error.value && schedules.value.length === 0)

const stateItems = computed(() => [
  { value: 'true', label: t('hrShifts.filters.active'), testId: 'hr-shifts-schedules-active' },
  { value: 'all', label: t('hrShifts.filters.allStates'), testId: 'hr-shifts-schedules-all' },
  { value: 'false', label: t('hrShifts.filters.archived'), testId: 'hr-shifts-schedules-archived' },
])

function setState(value: string) {
  if (!hydrated.value) return
  void router.replace({
    query: { ...route.query, active: value === 'true' ? undefined : value, offset: undefined },
    hash: route.hash,
  })
}

function setPage(next: number) {
  if (!hydrated.value || query.isFetching.value || next < 1 || next > pages.value) return
  void router.replace({
    query: { ...route.query, offset: next > 1 ? (next - 1) * HR_SHIFTS_PAGE_SIZE : undefined },
    hash: route.hash,
  })
}

const archiving = ref<HrShiftSchedule | null>(null)
const archiveError = ref('')
const { mutateAsync: archiveSchedule, isPending: archivingPending } = useArchiveHrShiftSchedule()

/** A schedule still planned for an employee is refused by the engine (422); the message is shown inline. */
async function confirmArchive() {
  if (!archiving.value || !hydrated.value || archivingPending.value) return
  archiveError.value = ''
  try {
    await archiveSchedule(archiving.value.id)
    archiving.value = null
  } catch (cause) {
    archiveError.value = cause instanceof ApiError ? cause.message : t('errors.generic')
  }
}

const createTo = computed(() => canManage.value ? { path: '/hr/shifts/schedules/new' } : undefined)
</script>

<template>
  <SharedListPage
    v-if="isListRoute"
    :title="t('hrShifts.schedulesTitle')"
    :description="t('hrShifts.schedulesDescription')"
    :create-to="createTo"
    :create-label="t('hrShifts.newSchedule')"
    create-test-id="hr-shifts-schedules-new"
    :back-to="{ path: '/hr/shifts' }"
    :back-label="t('hrShifts.title')"
  >
    <div class="webvue-page-stack">
      <UAlert v-if="archiveError" role="alert" color="error" variant="subtle" :title="archiveError" data-testid="hr-shifts-archive-error" />
      <SharedInlineConfirm
        v-if="archiving"
        :title="t('hrShifts.archiveConfirm', { name: archiving.name })"
        :confirm-label="t('hrShifts.archive')"
        :cancel-label="t('app.back')"
        :pending="archivingPending"
        :disabled="!hydrated"
        color="error"
        @confirm="confirmArchive"
        @cancel="archiving = null"
      />

      <SharedListCard>
        <template #filters>
          <SharedSegmentedControl
            :model-value="activeFilter"
            :items="stateItems"
            :label="t('hrShifts.filters.state')"
            :disabled="!hydrated"
            @update:model-value="setState"
          />
        </template>
        <SharedPageState :error="query.error.value" :keep-content="schedules.length > 0" @retry="query.refetch">
          <SharedEmptyState v-if="showEmpty" class="m-(--webvue-card-pad-dense)" :title="t('hrShifts.schedulesEmpty')" :description="t('hrShifts.schedulesEmptyHint')" />
          <ShiftScheduleTable
            v-else
            :schedules="schedules"
            :caption="t('hrShifts.schedulesTitle')"
            :loading="query.isLoading.value"
            :can-manage="canManage"
            @archive="archiving = $event"
            @retry="query.refetch"
          />
        </SharedPageState>
        <template v-if="query.data.value && !showEmpty" #footer>
          <SharedListFooter
            :count-label="t('hrShifts.footer', { shown: schedules.length, total }, total)"
            :page="page"
            :pages="pages"
            :disabled="query.isFetching.value"
            count-test-id="hr-shifts-schedules-count"
            @update:page="setPage"
          />
        </template>
      </SharedListCard>
    </div>
  </SharedListPage>
  <NuxtPage />
</template>
