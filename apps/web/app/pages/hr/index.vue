<script setup lang="ts">
import DirectoryTable from '@/components/hr/DirectoryTable.vue'
import { returnToQuery } from '@webvue/ui/app/utils/safeReturnTo'
import { HR_EXPIRY_WINDOWS, useHrExpiring, useHrSaudization } from '@/composables/useHrReports'
import { useHrEmployees } from '@/composables/useHrEmployees'
import { employeeKpiTiles } from '@/utils/hrKpis'

const { t, n } = useI18n()
const { can } = useAccess()
const route = useRoute()
// Managers see what expires within the first report window, with a link to the full report.
const canManage = computed(() => can('hr.employees.manage'))
const expiring = useHrExpiring(HR_EXPIRY_WINDOWS[0], canManage)
const expiringCount = computed(() => expiring.data.value?.total ?? 0)
// The KPI tiles are server totals: the employee list asked for one row (its `total`) and the shared report queries. A tile behind
// a capability the viewer lacks is left out instead of showing a dash.
// Hidden tiles ask nothing; the expiring report stays because the alert below reads it too.
const { shown: kpisShown } = useKpiVisibility()
const canArchive = computed(() => can('hr.employees.archive'))
const headcount = useHrEmployees({ limit: 1 }, kpisShown)
const archivedHeadcount = useHrEmployees({ limit: 1, archived: true }, computed(() => kpisShown.value && canArchive.value))
const saudization = useHrSaudization(computed(() => kpisShown.value && canManage.value))
const kpiTiles = computed(() => employeeKpiTiles({
  headcount: headcount.data.value?.total ?? null,
  archived: canArchive.value ? archivedHeadcount.data.value?.total ?? null : undefined,
  saudiPercent: canManage.value ? saudization.data.value?.overall.saudi_percent ?? null : undefined,
  expiring: canManage.value ? expiring.data.value?.total ?? null : undefined,
  expiryDays: HR_EXPIRY_WINDOWS[0],
}, t, n))
const initialDepartmentId = typeof route.query.department_id === 'string' ? Number(route.query.department_id) : NaN
const selectedDepartmentId = ref<number | null>(Number.isSafeInteger(initialDepartmentId) && initialDepartmentId > 0 ? initialDepartmentId : null)
// The create panel's own back trip is literal (employees/new.vue drops a referrer's returnTo and keeps
// only the list state), so the link carries the list state and nothing else.
const createTo = computed(() => {
  if (!canManage.value) return undefined
  const { returnTo: _referrer, ...listQuery } = route.query
  return { path: '/hr/employees/new', query: listQuery }
})
function editEmployee(id: number) { void navigateTo({ path: `/hr/employees/${id}/edit`, query: returnToQuery(route.fullPath) }) }
</script>

<template>
  <SharedListPage
    :title="t('nav.employees')"
    :create-to="createTo"
    :create-label="t('hr.directory.newEmployee')"
    create-test-id="hr-employee-new"
    kpi-toggle
  >
    <div class="webvue-page-stack">
      <SharedKpiStrip :tiles="kpiTiles" :loading="headcount.isLoading.value" :label="t('hr.kpi.label')" data-testid="hr-kpi-strip" />
      <UAlert
        v-if="expiringCount > 0"
        color="warning"
        variant="subtle"
        icon="i-lucide-calendar-clock"
        :title="t('hr.reports.expiring.alert', { count: n(expiringCount), days: HR_EXPIRY_WINDOWS[0] }, expiringCount)"
        :actions="[{ label: t('hr.reports.expiring.viewReports'), to: '/hr/reports', color: 'neutral', variant: 'outline' }]"
        data-testid="hr-expiring-alert"
      />
      <DirectoryTable v-model:department-id="selectedDepartmentId" @manage="editEmployee" />
    </div>
  </SharedListPage>
</template>
