<script setup lang="ts">
import DepartureTable from '@/components/hr/lifecycle/DepartureTable.vue'
import FilterBar from '@webvue/ui/app/components/shared/data/FilterBar.vue'
import { hrDepartureListQuery, useHrDepartures, type HrDepartureListParams } from '@/composables/useHrOffboarding'

const NAMESPACE = 'hrOffboarding'
const PAGE_SIZE = 25
const route = useRoute()
const router = useRouter()
const { t } = useI18n()
const { can } = useAccess()
const hydrated = useHydrated()
const forbidden = computed(() => !can('hr.offboarding.read'))
const canManage = computed(() => can('hr.offboarding.manage'))
// The list is this page's own screen and stays behind its create panel; the plan pages and the record
// are full pages of their own, so the list is not drawn under them.
const isListRoute = computed(() => {
  const path = route.path.replace(/\/+$/, '') || '/'
  return path === '/hr/offboarding' || path === '/hr/offboarding/new'
})
const search = computed(() => typeof route.query.q === 'string' ? route.query.q : '')
const cleared = computed<'true' | 'false' | undefined>(() => route.query.cleared === 'true' || route.query.cleared === 'false' ? route.query.cleared : undefined)
const offset = computed(() => {
  const value = Number(route.query.offset)
  return Number.isSafeInteger(value) && value > 0 ? value : 0
})
const params = computed<HrDepartureListParams>(() => ({ q: search.value || undefined, cleared: cleared.value, limit: PAGE_SIZE, offset: offset.value }))
const query = useHrDepartures(params, computed(() => !forbidden.value))
const departures = computed(() => query.data.value?.items ?? [])
const total = computed(() => query.data.value?.total ?? 0)
const page = computed(() => Math.floor(offset.value / PAGE_SIZE) + 1)
const pages = computed(() => Math.max(1, Math.ceil(total.value / PAGE_SIZE)))
const activeFilterCount = computed(() => Number(Boolean(search.value.trim())) + Number(Boolean(cleared.value)))
const clearedOptions = computed(() => [
  { value: 'all', label: t(`${NAMESPACE}.departures.allClearance`) },
  { value: 'true', label: t(`${NAMESPACE}.departures.clearedOnly`) },
  { value: 'false', label: t(`${NAMESPACE}.departures.unclearedOnly`) },
])
const listQuery = computed(() => {
  const { returnTo: _returnTo, ...rest } = route.query
  return rest
})
const createTo = computed(() => canManage.value ? { path: '/hr/offboarding/new', query: listQuery.value } : undefined)
const departureTo = (departure: { employee: { id: number } }) => ({ path: `/hr/offboarding/${departure.employee.id}`, query: listQuery.value })
function syncQuery(next: { q?: string, cleared?: string, offset?: number }) {
  if (!isListRoute.value) return
  const trimmed = (next.q ?? search.value).trim()
  const nextCleared = next.cleared === undefined ? cleared.value : next.cleared
  void router.replace({ query: {
    ...(trimmed ? { q: trimmed } : {}),
    ...(nextCleared && nextCleared !== 'all' ? { cleared: nextCleared } : {}),
    ...(next.offset ? { offset: String(next.offset) } : {}),
  } })
}
function setSearch(value: string) { syncQuery({ q: value, offset: 0 }) }
function setCleared(value: unknown) { syncQuery({ cleared: String(value ?? 'all'), offset: 0 }) }
function clearFilters() { syncQuery({ q: '', cleared: 'all', offset: 0 }) }
function setPage(next: number) {
  if (hydrated.value && next >= 1 && next <= pages.value) syncQuery({ offset: (next - 1) * PAGE_SIZE })
}
</script>

<template>
  <SharedListPage
    v-if="isListRoute"
    data-testid="hr-offboarding-departures"
    :title="t(`${NAMESPACE}.departures.title`)"
    :create-to="createTo"
    :create-label="t(`${NAMESPACE}.departures.new`)"
    create-test-id="hr-offboarding-new"
  >
    <SharedForbiddenState v-if="forbidden" :description="t(`${NAMESPACE}.errors.forbidden`)" />
    <SharedListCard v-else>
      <template #filters>
        <div id="filters" class="w-full min-w-0">
          <FilterBar embedded class="w-full" :active-count="activeFilterCount" :disabled="!hydrated" @clear="clearFilters">
            <template #search>
              <UInput
                :model-value="search"
                class="min-w-48 flex-1"
                icon="i-lucide-search"
                :aria-label="t(`${NAMESPACE}.departures.search`)"
                :placeholder="t(`${NAMESPACE}.departures.search`)"
                :disabled="!hydrated"
                @update:model-value="setSearch(String($event))"
              />
            </template>
            <template #default>
              <USelect
                class="w-full md:w-48"
                :items="clearedOptions"
                :model-value="cleared ?? 'all'"
                :aria-label="t(`${NAMESPACE}.departures.clearedFilter`)"
                :disabled="!hydrated"
                @update:model-value="setCleared"
              />
            </template>
            <template #active>
              <div v-if="search.trim()" class="flex flex-wrap items-center gap-2">
                <SharedFilterChip :label="t(`${NAMESPACE}.departures.search`) + ': ' + search" @remove="setSearch('')" />
              </div>
            </template>
          </FilterBar>
        </div>
      </template>
      <SharedPageState
        v-if="query.isLoading.value || query.error.value || !departures.length"
        class="m-(--webvue-card-pad-dense)"
        :loading="query.isLoading.value"
        :error="query.error.value"
        :empty="!departures.length"
        :empty-text="t(`${NAMESPACE}.departures.empty`)"
        @retry="query.refetch"
      />
      <DepartureTable v-else :departures="departures" :namespace="NAMESPACE" :to-for="departureTo" />
      <template v-if="departures.length" #footer>
        <SharedListFooter
          :count-label="t(`${NAMESPACE}.footer.results`, { shown: departures.length, total }, total)"
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
