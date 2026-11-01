<script setup lang="ts">
import EmployeeSearchSelect from '@/components/hr/EmployeeSearchSelect.vue'
import WarningTable from '@/components/hr/warnings/WarningTable.vue'
import { HR_WARNING_STATES, type HrWarningState } from '@liwan/contracts'
import { returnToQuery } from '@liwan/ui/app/utils/safeReturnTo'
import { HR_WARNINGS_PAGE_SIZE, type HrWarning } from '@/composables/useHrWarnings'

const route = useRoute()
const router = useRouter()
const { t } = useI18n()
const hydrated = useHydrated()
const { can } = useAccess()

const LIMIT = HR_WARNINGS_PAGE_SIZE
// The warning list is this page's own screen and stays behind its create panel; a warning record is a full page.
// A direct manager reaches the create panel over this route without reading the list: the list shows only for readers.
const canRead = computed(() => can('hr.warnings.read'))
const isListRoute = computed(() => {
  const path = route.path.replace(/\/+$/, '') || '/'
  return canRead.value && (path === '/hr/warnings' || path === '/hr/warnings/new')
})
const { canIssue } = useHrWarningIssuer()

function positiveParam(value: unknown) {
  const raw = Array.isArray(value) ? value[0] : value
  const parsed = Number(raw)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null
}
function stateParam(value: unknown): HrWarningState | 'all' {
  const raw = Array.isArray(value) ? value[0] : value
  return HR_WARNING_STATES.find(candidate => candidate === raw) ?? 'all'
}

const employeeId = computed(() => positiveParam(route.query.employee_id))
const typeId = computed(() => positiveParam(route.query.type_id))
const state = computed(() => stateParam(route.query.state))
const offset = computed(() => Math.max(0, Number(route.query.offset ?? 0) || 0))

const warnings = useHrWarningList(computed(() => ({
  employeeId: employeeId.value,
  typeId: typeId.value,
  state: state.value,
  limit: LIMIT,
  offset: offset.value,
})))
const types = useHrWarningTypes('all')

const items = computed(() => warnings.data.value?.items ?? [])
const total = computed(() => warnings.data.value?.total ?? 0)
const page = computed(() => Math.floor(offset.value / LIMIT) + 1)
const pages = computed(() => Math.max(1, Math.ceil(total.value / LIMIT)))
const showEmpty = computed(() => !warnings.isLoading.value && !warnings.error.value && items.value.length === 0)
const activeFilterCount = computed(() => [employeeId.value, typeId.value, state.value === 'all' ? null : state.value].filter(Boolean).length)

const typeOptions = computed(() => (types.data.value?.items ?? []).map(type => ({ value: String(type.id), label: type.name })))
const stateOptions = computed(() => (['all', ...HR_WARNING_STATES] as const).map(value => ({
  value,
  label: value === 'all' ? t('hrWarnings.allStates') : t(`hrWarnings.state.${value}`),
  testId: `hr-warnings-state-${value}`,
})))

function writeQuery(patch: Partial<{ employee: number | null; type: number | null; state: HrWarningState | 'all'; offset: number }>) {
  if (!hydrated.value) return
  const nextState = patch.state ?? state.value
  void router.replace({
    query: {
      ...route.query,
      employee_id: (patch.employee !== undefined ? patch.employee : employeeId.value) ?? undefined,
      type_id: (patch.type !== undefined ? patch.type : typeId.value) ?? undefined,
      state: nextState === 'all' ? undefined : nextState,
      offset: (patch.offset ?? 0) > 0 ? patch.offset : undefined,
    },
    hash: route.hash,
  })
}
function setPage(next: number) {
  if (!hydrated.value || warnings.isFetching.value || next < 1 || next > pages.value) return
  writeQuery({ offset: (next - 1) * LIMIT })
}
function clearFilters() {
  void router.replace({ query: { ...route.query, employee_id: undefined, type_id: undefined, state: undefined, offset: undefined }, hash: route.hash })
}

const listQuery = computed(() => {
  const { returnTo: _referrer, ...context } = route.query
  return context
})
const createTo = computed(() => canIssue.value ? { path: '/hr/warnings/new', query: listQuery.value } : undefined)
function warningTo(row: HrWarning) {
  return { path: `/hr/warnings/${row.id}`, query: returnToQuery(route.fullPath) }
}
</script>

<template>
  <SharedListPage
    v-if="isListRoute"
    :title="t('nav.warnings')"
    :create-to="createTo"
    :create-label="t('hrWarnings.new')"
    create-test-id="hr-warning-new"
  >
    <SharedListCard>
      <template #filters>
        <div class="liwan-page-stack">
          <SharedSegmentedControl
            :model-value="state"
            :items="stateOptions"
            :label="t('hrWarnings.filter.state')"
            :disabled="!hydrated"
            @update:model-value="writeQuery({ state: stateParam($event), offset: 0 })"
          />
          <SharedFilterBar embedded class="w-full" :active-count="activeFilterCount" :disabled="!hydrated" @clear="clearFilters">
            <SharedFilterField :label="t('hrWarnings.columns.employee')" for="hr-warnings-employee">
              <EmployeeSearchSelect id="hr-warnings-employee" :model-value="employeeId" :any-label="t('hrWarnings.anyEmployee')" :disabled="!hydrated" test-id="hr-warnings-employee" @update:model-value="writeQuery({ employee: $event, offset: 0 })" />
            </SharedFilterField>
            <SharedFilterField :label="t('hrWarnings.columns.type')" for="hr-warnings-type">
              <USelect
                id="hr-warnings-type"
                class="w-full"
                :model-value="typeId ? String(typeId) : undefined"
                :items="typeOptions"
                :placeholder="t('hrWarnings.anyType')"
                :disabled="!hydrated || types.isLoading.value"
                data-testid="hr-warnings-type"
                @update:model-value="writeQuery({ type: $event ? Number($event) : null, offset: 0 })"
              />
            </SharedFilterField>
            <template #active>
              <SharedFilterChip v-if="state !== 'all'" :label="t(`hrWarnings.state.${state}`)" @remove="writeQuery({ state: 'all', offset: 0 })" />
            </template>
          </SharedFilterBar>
        </div>
      </template>

      <SharedPageState :error="warnings.error.value" :keep-content="items.length > 0" @retry="warnings.refetch">
        <SharedEmptyState v-if="showEmpty" class="m-(--liwan-card-pad-dense)" :title="t('hrWarnings.emptyTitle')" :description="t('hrWarnings.emptyHint')" />
        <WarningTable v-else :warnings="items" :row-to="warningTo" :loading="warnings.isLoading.value" :caption="t('hrWarnings.title')" />
      </SharedPageState>
      <template v-if="warnings.data.value && !showEmpty" #footer>
        <SharedListFooter
          :count-label="t('hrWarnings.footer', { shown: items.length, total }, total)"
          :page="page"
          :pages="pages"
          :disabled="warnings.isFetching.value"
          count-test-id="hr-warnings-count"
          @update:page="setPage"
        />
      </template>
    </SharedListCard>
  </SharedListPage>
  <NuxtPage />
</template>
