<script setup lang="ts">
import RunTable from '@/components/hr/lifecycle/RunTable.vue'
import FilterBar from '@liwan/ui/app/components/shared/data/FilterBar.vue'
import { useHrOnboardingRuns, type HrRunListParams } from '@/composables/useHrOnboarding'
import { hrRunKpiQueries, hrRunKpiTiles } from '@/utils/hrStaffingKpis'

const NAMESPACE = 'hrOnboarding'
const PAGE_SIZE = 25
const route = useRoute()
const router = useRouter()
const { t } = useI18n()
const { can } = useAccess()
const hydrated = useHydrated()
const forbidden = computed(() => !can('hr.onboarding.read'))
const canManage = computed(() => can('hr.onboarding.manage'))
// The list is this page's own screen and stays behind its create panel; the plan pages and the record
// are full pages of their own, so the list is not drawn under them.
const isListRoute = computed(() => {
  const path = route.path.replace(/\/+$/, '') || '/'
  return path === '/hr/onboarding' || path === '/hr/onboarding/new'
})
const RUN_STATES = ['open', 'done', 'cancelled'] as const
const state = computed(() => RUN_STATES.find(value => value === route.query.state))
const offset = computed(() => {
  const value = Number(route.query.offset)
  return Number.isSafeInteger(value) && value > 0 ? value : 0
})
const params = computed<HrRunListParams>(() => ({ state: state.value, limit: PAGE_SIZE, offset: offset.value }))
const query = useHrOnboardingRuns(params, computed(() => !forbidden.value))
const runs = computed(() => query.data.value?.items ?? [])
const total = computed(() => query.data.value?.total ?? 0)
const page = computed(() => Math.floor(offset.value / PAGE_SIZE) + 1)
const pages = computed(() => Math.max(1, Math.ceil(total.value / PAGE_SIZE)))

// The tiles count the open and the done runs the endpoint filters by; the tile the list is showing reads the
// list's own total, and the other asks one row.
const { shown: kpisShown } = useKpiVisibility()
const kpiQueries = hrRunKpiQueries()
const kpisEnabled = computed(() => !forbidden.value && kpisShown.value)
const openReused = computed(() => state.value === 'open')
const doneReused = computed(() => state.value === 'done')
const openCount = useHrOnboardingRuns(kpiQueries.open, computed(() => kpisEnabled.value && !openReused.value))
const doneCount = useHrOnboardingRuns(kpiQueries.done, computed(() => kpisEnabled.value && !doneReused.value))
const kpiCounts = computed(() => ({
  open: openReused.value ? total.value : openCount.data.value?.total ?? null,
  done: doneReused.value ? total.value : doneCount.data.value?.total ?? null,
}))
const kpiTiles = computed(() => hrRunKpiTiles(kpiCounts.value, t, NAMESPACE))
const kpiLoading = computed(() => query.isLoading.value || openCount.isLoading.value || doneCount.isLoading.value)

const stateOptions = computed(() => [
  { value: 'all', label: t(`${NAMESPACE}.runs.allStates`) },
  { value: 'open', label: t(`${NAMESPACE}.states.open`) },
  { value: 'done', label: t(`${NAMESPACE}.states.done`) },
  { value: 'cancelled', label: t(`${NAMESPACE}.states.cancelled`) },
])
const listQuery = computed(() => {
  const { returnTo: _returnTo, ...rest } = route.query
  return rest
})
const createTo = computed(() => canManage.value ? { path: '/hr/onboarding/new', query: listQuery.value } : undefined)
const runTo = (run: { id: number }) => ({ path: `/hr/onboarding/${run.id}`, query: listQuery.value })
function syncQuery(next: { state?: string, offset?: number }) {
  if (!isListRoute.value) return
  void router.replace({ query: {
    ...(next.state && next.state !== 'all' ? { state: next.state } : {}),
    ...(next.offset ? { offset: String(next.offset) } : {}),
  } })
}
function setState(value: unknown) {
  syncQuery({ state: String(value ?? 'all'), offset: 0 })
}
function setPage(next: number) {
  if (hydrated.value && next >= 1 && next <= pages.value) syncQuery({ state: state.value ?? 'all', offset: (next - 1) * PAGE_SIZE })
}
</script>

<template>
  <SharedListPage
    v-if="isListRoute"
    data-testid="hr-onboarding-runs"
    :title="t(`${NAMESPACE}.runs.title`)"
    :create-to="createTo"
    :create-label="t(`${NAMESPACE}.runs.new`)"
    create-test-id="hr-onboarding-new"
  >
    <template v-if="!forbidden" #kpis>
      <SharedKpiStrip :tiles="kpiTiles" :loading="kpiLoading" :label="t(`${NAMESPACE}.kpi.label`)" data-testid="hr-onboarding-kpi-strip" />
    </template>
    <template v-if="!forbidden" #actions>
      <UButton color="neutral" variant="outline" icon="i-lucide-list-checks" to="/hr/onboarding/plans" :disabled="!hydrated" :label="t(`${NAMESPACE}.plans.title`)" data-testid="hr-onboarding-plans" />
    </template>

    <SharedForbiddenState v-if="forbidden" :description="t(`${NAMESPACE}.errors.forbidden`)" />
    <SharedListCard v-else>
      <template #filters>
        <div id="filters" class="w-full min-w-0">
          <FilterBar embedded class="w-full" :active-count="state ? 1 : 0" :disabled="!hydrated" @clear="setState('all')">
            <template #default>
              <USelect
                class="w-full md:w-48"
                :items="stateOptions"
                :model-value="state ?? 'all'"
                :aria-label="t(`${NAMESPACE}.runs.state`)"
                :disabled="!hydrated"
                @update:model-value="setState"
              />
            </template>
          </FilterBar>
        </div>
      </template>
      <SharedPageState empty-icon="i-lucide-user-plus"
        v-if="query.isLoading.value || query.error.value || !runs.length"
        class="m-(--liwan-card-pad-dense)"
        :loading="query.isLoading.value"
        :error="query.error.value"
        :empty="!runs.length"
        :empty-text="t(`${NAMESPACE}.runs.empty`)"
        @retry="query.refetch"
      />
      <RunTable v-else :runs="runs" :namespace="NAMESPACE" :to-for="runTo" />
      <template v-if="runs.length" #footer>
        <SharedListFooter
          :count-label="t(`${NAMESPACE}.footer.results`, { shown: runs.length, total }, total)"
          :page="page"
          :pages="pages"
          :disabled="query.isFetching.value"
          @update:page="setPage"
        />
      </template>
    </SharedListCard>
  </SharedListPage>
  <NuxtPage />
</template>
