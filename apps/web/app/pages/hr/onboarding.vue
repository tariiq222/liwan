<script setup lang="ts">
import RunTable from '@/components/hr/lifecycle/RunTable.vue'
import FilterBar from '@webvue/ui/app/components/shared/data/FilterBar.vue'
import { useHrOnboardingRuns, type HrRunListParams } from '@/composables/useHrOnboarding'

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
const state = computed<'open' | 'done' | undefined>(() => route.query.state === 'open' || route.query.state === 'done' ? route.query.state : undefined)
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
const stateOptions = computed(() => [
  { value: 'all', label: t(`${NAMESPACE}.runs.allStates`) },
  { value: 'open', label: t(`${NAMESPACE}.states.open`) },
  { value: 'done', label: t(`${NAMESPACE}.states.done`) },
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
      <SharedPageState
        v-if="query.isLoading.value || query.error.value || !runs.length"
        class="m-(--webvue-card-pad-dense)"
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
