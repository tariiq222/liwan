<script setup lang="ts">
import PayrollRunTable from '@/components/hr/payroll/PayrollRunTable.vue'
import { returnToQuery } from '@webvue/ui/app/utils/safeReturnTo'
import type { HrPayrollRunState, HrPayrollRunSummary } from '@webvue/contracts'
import { HR_PAYROLL_PAGE_SIZE, hrPayrollRunsQuery, type HrPayrollRunStateFilter } from '@/composables/useHrPayrollRuns'
import { currentPayrollMonth } from '@/utils/payrollFormat'

const route = useRoute()
const router = useRouter()
const { t } = useI18n()
const hydrated = useHydrated()
const { can } = useAccess()

const LIMIT = HR_PAYROLL_PAGE_SIZE
const STATES: HrPayrollRunState[] = ['draft', 'computed', 'approved', 'posted', 'paid']
const ALL_YEARS = 'all'
// The runs list is this page's own screen and stays behind its create panel; a run, its payslips and the settings
// are full pages of their own.
const isListRoute = computed(() => {
  const path = route.path.replace(/\/+$/, '') || '/'
  return path === '/hr/payroll' || path === '/hr/payroll/new'
})
const canManage = computed(() => can('hr.payroll.manage'))
const canConfig = computed(() => can('hr.payroll.config'))

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
const runs = useHrPayrollRuns(computed(() => hrPayrollRunsQuery({ year: year.value, state: state.value, limit: LIMIT, offset: offset.value })))

const items = computed(() => runs.data.value?.items ?? [])
const total = computed(() => runs.data.value?.total ?? 0)
const page = computed(() => Math.floor(offset.value / LIMIT) + 1)
const pages = computed(() => Math.max(1, Math.ceil(total.value / LIMIT)))
const showEmpty = computed(() => !runs.isLoading.value && !runs.error.value && items.value.length === 0)
const activeFilterCount = computed(() => [year.value, state.value === 'all' ? null : state.value].filter(Boolean).length)

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
const settingsTo = computed(() => ({ path: '/hr/payroll/settings', query: returnToQuery(route.fullPath) }))
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
    <template v-if="canConfig" #actions>
      <UButton color="neutral" variant="outline" icon="i-lucide-settings" :to="settingsTo" :disabled="!hydrated" :label="t('hrPayroll.settings.title')" data-testid="hr-payroll-settings-link" />
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
        <SharedEmptyState v-if="showEmpty" class="m-(--webvue-card-pad-dense)" :title="t('hrPayroll.runs.emptyTitle')" :description="t('hrPayroll.runs.emptyHint')" />
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
