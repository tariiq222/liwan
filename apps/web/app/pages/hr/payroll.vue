<script setup lang="ts">
import PayrollRunTable from '@/components/hr/payroll/PayrollRunTable.vue'
import { returnToQuery } from '@liwan/ui/app/utils/safeReturnTo'
import type { HrPayrollRunState, HrPayrollRunSummary } from '@liwan/contracts'
import { HR_PAYROLL_PAGE_SIZE, hrPayrollRunsQuery, type HrPayrollRunStateFilter } from '@/composables/useHrPayrollRuns'
import { currentPayrollMonth } from '@/utils/payrollFormat'
import { hrPayrollRunKpiQueries, hrPayrollRunKpiTiles } from '@/utils/hrKpis'

const route = useRoute()
const router = useRouter()
const { t } = useI18n()
const hydrated = useHydrated()
const { can } = useAccess()

const LIMIT = HR_PAYROLL_PAGE_SIZE
// Posted and paid runs exist (and are listed) only with the finance bridge; the server answers the filter either way.
const STATES: HrPayrollRunState[] = ['draft', 'computed', 'approved', 'posted', 'paid']
const ALL_YEARS = 'all'
// The runs list is this page's own screen and stays behind its create panel; a run, its payslips and the settings
// are full pages of their own.
const isListRoute = computed(() => {
  const path = route.path.replace(/\/+$/, '') || '/'
  return path === '/hr/payroll' || path === '/hr/payroll/new'
})
const canManage = computed(() => can('hr.payroll.manage'))
const canRead = computed(() => can('hr.payroll.read'))

function firstParam(value: unknown) {
  return Array.isArray(value) ? value[0] : value
}
function yearParam(value: unknown) {
  const parsed = Number(firstParam(value))
  return Number.isInteger(parsed) && parsed >= 2000 && parsed <= 2100 ? parsed : null
}
function stateParam(value: unknown): HrPayrollRunStateFilter {
  return STATES.find(candidate => candidate === firstParam(value)) ?? 'all'
}
function offsetParam(value: unknown) {
  const parsed = Number(firstParam(value))
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 0
}

const year = computed(() => yearParam(route.query.year))
const state = computed(() => stateParam(route.query.state))
const offset = computed(() => offsetParam(route.query.offset))
// The list is fetched only on its own routes: a run, its payslips, the settings and "mine" never need it.
const runs = useHrPayrollRuns(computed(() => hrPayrollRunsQuery({ year: year.value, state: state.value, limit: LIMIT, offset: offset.value })), isListRoute)

const items = computed(() => runs.data.value?.items ?? [])
const total = computed(() => runs.data.value?.total ?? 0)
const page = computed(() => Math.floor(offset.value / LIMIT) + 1)
const pages = computed(() => Math.max(1, Math.ceil(total.value / LIMIT)))
const showEmpty = computed(() => !runs.isLoading.value && !runs.error.value && items.value.length === 0)
const activeFilterCount = computed(() => [year.value, state.value === 'all' ? null : state.value].filter(Boolean).length)
// A filter that matches nothing is not the same as no run at all: the empty state says which one it is and offers the
// way out (clear the filters, else create the first run).
const filtered = computed(() => activeFilterCount.value > 0)

// The tiles count runs per state with one-row requests (their `total`), never a run's amounts. They ask nothing while the
// figures are hidden or the viewer cannot read payroll; the all-runs figure reuses the list total while the list is unfiltered.
const { shown: kpisShown } = useKpiVisibility()
const kpisEnabled = computed(() => isListRoute.value && kpisShown.value && canRead.value)
const reuseListTotal = computed(() => activeFilterCount.value === 0)
const kpiQueries = hrPayrollRunKpiQueries()
const allCount = useHrPayrollRuns(kpiQueries.all, computed(() => kpisEnabled.value && !reuseListTotal.value))
const draftCount = useHrPayrollRuns(kpiQueries.draft, kpisEnabled)
const computedCount = useHrPayrollRuns(kpiQueries.computed, kpisEnabled)
const approvedCount = useHrPayrollRuns(kpiQueries.approved, kpisEnabled)
const kpiTiles = computed(() => hrPayrollRunKpiTiles({
  all: (reuseListTotal.value ? runs.data.value?.total : allCount.data.value?.total) ?? null,
  draft: draftCount.data.value?.total ?? null,
  computed: computedCount.data.value?.total ?? null,
  approved: approvedCount.data.value?.total ?? null,
}, t))
const kpiLoading = computed(() => (reuseListTotal.value ? runs.isLoading.value : allCount.isLoading.value)
  || draftCount.isLoading.value || computedCount.isLoading.value || approvedCount.isLoading.value)

// The years offered: the current one, the three before and the next, plus whichever year the URL asks for.
const yearOptions = computed(() => {
  const current = Number(currentPayrollMonth().slice(0, 4))
  const years = new Set([current + 1, current, current - 1, current - 2, current - 3, ...(year.value ? [year.value] : [])])
  return [
    { value: ALL_YEARS, label: t('hrPayroll.runs.anyYear') },
    ...[...years].sort((a, b) => b - a).map(value => ({ value: String(value), label: String(value) })),
  ]
})
const stateOptions = computed(() => [
  { value: 'all', label: t('hrPayroll.runs.anyState') },
  ...STATES.map(value => ({ value, label: t(`hrPayroll.runs.state.${value}`) })),
])

function writeQuery(patch: Partial<{ year: number | null; state: HrPayrollRunStateFilter; offset: number }>) {
  if (!hydrated.value) return
  const nextState = patch.state ?? state.value
  void router.replace({
    query: {
      ...route.query,
      year: (patch.year !== undefined ? patch.year : year.value) ?? undefined,
      state: nextState === 'all' ? undefined : nextState,
      offset: (patch.offset ?? 0) > 0 ? patch.offset : undefined,
    },
    hash: route.hash,
  })
}
function setPage(next: number) {
  if (!hydrated.value || runs.isFetching.value || next < 1 || next > pages.value) return
  writeQuery({ offset: (next - 1) * LIMIT })
}
function clearFilters() {
  void router.replace({ query: { ...route.query, year: undefined, state: undefined, offset: undefined }, hash: route.hash })
}

const listQuery = computed(() => {
  const { returnTo: _referrer, ...context } = route.query
  return context
})
const createTo = computed(() => canManage.value ? { path: '/hr/payroll/new', query: listQuery.value } : undefined)
function runTo(row: HrPayrollRunSummary) {
  return { path: `/hr/payroll/${row.id}`, query: returnToQuery(route.fullPath) }
}
</script>

<template>
  <SharedListPage
    v-if="isListRoute"
    :title="t('hrPayroll.title')"
    :create-to="createTo"
    :create-label="t('hrPayroll.runs.new')"
    create-test-id="hr-payroll-new"
  >
    <template v-if="canRead" #kpis>
      <SharedKpiStrip :tiles="kpiTiles" :loading="kpiLoading" :label="t('hrPayroll.kpi.label')" data-testid="hr-payroll-kpi-strip" />
    </template>
    <SharedListCard>
      <template #filters>
        <SharedFilterBar embedded class="w-full" :active-count="activeFilterCount" :disabled="!hydrated" @clear="clearFilters">
          <SharedFilterField :label="t('hrPayroll.runs.filter.year')" for="hr-payroll-year">
            <USelect
              id="hr-payroll-year"
              class="w-full"
              :model-value="year ? String(year) : ALL_YEARS"
              :items="yearOptions"
              :disabled="!hydrated"
              data-testid="hr-payroll-year"
              @update:model-value="writeQuery({ year: $event === ALL_YEARS ? null : Number($event) })"
            />
          </SharedFilterField>
          <SharedFilterField :label="t('hrPayroll.runs.filter.state')" for="hr-payroll-state">
            <USelect
              id="hr-payroll-state"
              class="w-full"
              :model-value="state"
              :items="stateOptions"
              :disabled="!hydrated"
              data-testid="hr-payroll-state"
              @update:model-value="writeQuery({ state: stateParam($event) })"
            />
          </SharedFilterField>
          <template #active>
            <SharedFilterChip v-if="year" :label="t('hrPayroll.runs.yearValue', { year })" @remove="writeQuery({ year: null })" />
            <SharedFilterChip v-if="state !== 'all'" :label="t(`hrPayroll.runs.state.${state}`)" @remove="writeQuery({ state: 'all' })" />
          </template>
        </SharedFilterBar>
      </template>

      <SharedPageState :error="runs.error.value" :keep-content="items.length > 0" @retry="runs.refetch">
        <SharedEmptyState
          v-if="showEmpty"
          class="m-(--liwan-card-pad-dense)"
          :icon="filtered ? 'i-lucide-filter-x' : 'i-lucide-banknote'"
          :title="filtered ? t('hrPayroll.runs.emptyFiltered') : t('hrPayroll.runs.emptyTitle')"
          :description="filtered ? undefined : t('hrPayroll.runs.emptyHint')"
          data-testid="hr-payroll-empty"
        >
          <template v-if="filtered" #action>
            <UButton
              icon="i-lucide-rotate-ccw"
              :label="t('hrPayroll.runs.clearFilters')"
              :disabled="!hydrated"
              data-testid="hr-payroll-empty-clear"
              @click="clearFilters"
            />
          </template>
          <template v-else-if="createTo" #action>
            <UButton :to="createTo" icon="i-lucide-plus" :label="t('hrPayroll.runs.new')" :disabled="!hydrated" data-testid="hr-payroll-empty-create" />
          </template>
        </SharedEmptyState>
        <PayrollRunTable v-else :runs="items" :row-to="runTo" :loading="runs.isLoading.value" :caption="t('hrPayroll.title')" />
      </SharedPageState>
      <template v-if="runs.data.value && !showEmpty" #footer>
        <SharedListFooter
          :count-label="t('hrPayroll.runs.footer', { shown: items.length, total }, total)"
          :page="page"
          :pages="pages"
          :disabled="runs.isFetching.value"
          count-test-id="hr-payroll-count"
          @update:page="setPage"
        />
      </template>
    </SharedListCard>
  </SharedListPage>
  <NuxtPage />
</template>
