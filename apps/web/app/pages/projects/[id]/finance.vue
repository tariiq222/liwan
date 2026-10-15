<script setup lang="ts">
import type { RouteLocationNormalized } from 'vue-router'
import { refDebounced } from '@vueuse/core'
import { ApiError } from '@/composables/useApi'
import { useProjectFinanceList } from '@/composables/useProjectFinance'
import { useProject } from '@/composables/useProjects'
import FinanceEntryTable from '@/components/pmo/projects/finance/FinanceEntryTable.vue'
import FinanceSummaryCards from '@/components/pmo/projects/finance/FinanceSummaryCards.vue'
import FilterBar from '@/components/shared/data/FilterBar.vue'
import {
  FINANCE_PAGE,
  parseFinanceKind,
  parseFinanceListRoute,
  patchFinanceListRoute,
  nextOffsetAfterListResult,
  sameFinanceListRoute,
  serializeFinanceListRoute,
  type FinanceListRouteState,
} from '@/utils/projectFinance'
import { parsePositiveId } from '@/utils/routeParams'
import { returnToQuery } from '@/utils/safeReturnTo'

const route = useRoute()
const router = useRouter()
const { t } = useI18n()
const hydrated = useHydrated()
const normalizedPath = computed(() => route.path.replace(/\/+$/, '') || '/')
const projectId = computed(() => parsePositiveId(route.params.id))
const { data: project } = useProject(projectId)
const isListRoute = computed(() => {
  const rest = normalizedPath.value.replace(/^\/projects\/[^/]+\/finance/, '')
  return rest === '' || rest === '/new'
})

const filters = reactive<FinanceListRouteState>(parseFinanceListRoute(route.query as Record<string, unknown>))
const search = ref(filters.q)
const debouncedSearch = refDebounced(search, 250)
let applyingRoute = false
let writeQuery: Promise<void> = Promise.resolve()
let pendingDeparture: RouteLocationNormalized | null = null
let pendingOwnQuery: { target: string; navigation: RouteLocationNormalized | null } | null = null
const listPath = () => `/projects/${projectId.value}/finance`
// Auth publishes the router's actual target before awaiting identity refresh.
// Track even a newer list/query navigation: an older cancelled record must not
// resume a debounce writer while that newer navigation is still pending.
const stopNavigationStart = useNuxtApp().hook('nasq:navigation:start', to => {
  pendingDeparture = to
  if (pendingOwnQuery && !pendingOwnQuery.navigation && to.fullPath === pendingOwnQuery.target) pendingOwnQuery.navigation = to
})
onBeforeRouteLeave(to => { pendingDeparture = to })
onBeforeRouteUpdate(to => { if (to.path.replace(/\/+$/, '') !== listPath()) pendingDeparture = to })
function resumeListWrites() {
  pendingDeparture = null
  // A failed write is already finishing its own promise. Requeueing here would
  // retry an identical refused navigation forever; later user edits still queue.
  if (!applyingRoute && router.currentRoute.value.path.replace(/\/+$/, '') === listPath()) void scheduleQueryWrite()
}
const stopAfterEach = router.afterEach((to, _from, failure) => {
  if (to !== pendingDeparture) return
  // Nuxt's page route can still name the previous project here. The successful
  // target owns its list identity; the writer separately checks the page's path.
  const targetListPath = `/projects/${parsePositiveId(to.params.id)}/finance`
  if (!failure && applyingRoute && to.path.replace(/\/+$/, '') === listPath() && to !== pendingOwnQuery?.navigation) {
    pendingOwnQuery = null
    const parsed = parseFinanceListRoute(to.query)
    search.value = parsed.q
    Object.assign(filters, parsed)
  }
  if (failure || to.path.replace(/\/+$/, '') === targetListPath) resumeListWrites()
})
const stopOnError = router.onError((_error, to) => { if (to === pendingDeparture) resumeListWrites() })
onScopeDispose(() => { stopNavigationStart(); stopAfterEach(); stopOnError() })


const listFilters = computed(() => ({
  kind: filters.kind,
  q: filters.q.trim() || undefined,
  limit: FINANCE_PAGE,
  offset: filters.offset,
}))
const list = useProjectFinanceList(computed(() => isListRoute.value ? projectId.value : null), listFilters)
const canManage = computed(() => list.data.value?.can_manage === true)
const items = computed(() => list.data.value?.items ?? [])
const total = computed(() => list.data.value?.total ?? 0)
const summary = computed(() => list.data.value?.summary)
const page = computed(() => Math.floor(filters.offset / FINANCE_PAGE) + 1)
const pages = computed(() => Math.max(1, Math.ceil(total.value / FINANCE_PAGE)))
const filtered = computed(() => Boolean(filters.q.trim()) || filters.kind !== 'all')
const activeFilterCount = computed(() => Number(Boolean(filters.q.trim())) + Number(filters.kind !== 'all'))
const notFound = computed(() => projectId.value === null || (list.error.value instanceof ApiError && [403, 404].includes(list.error.value.status)))

function applyPatch(patch: Partial<FinanceListRouteState>) {
  Object.assign(filters, patchFinanceListRoute(filters, patch))
}

function scheduleQueryWrite() {
  writeQuery = writeQuery.then(async () => {
    if (pendingDeparture || router.currentRoute.value.path.replace(/\/+$/, '') !== listPath()) return
    const query = serializeFinanceListRoute(filters)
    if (sameFinanceListRoute(query, serializeFinanceListRoute(parseFinanceListRoute(route.query as Record<string, unknown>)))) return
    const writeStartedAt = router.currentRoute.value
    let writeSucceeded = false
    applyingRoute = true
    let writeTarget: typeof pendingOwnQuery = null
    try {
      const context = Object.fromEntries(
        ['returnTo', 'taskContext', 'projectListReturnTo']
          .filter(key => typeof route.query[key] === 'string')
          .map(key => [key, route.query[key] as string]),
      )
      const target = { query: { ...query, ...context }, hash: route.hash }
      writeTarget = { target: router.resolve(target).fullPath, navigation: null }
      pendingOwnQuery = writeTarget
      writeSucceeded = !(await router.replace(target))
    }
    finally {
      applyingRoute = false
      const current = router.currentRoute.value
      const ownsDraft = writeTarget !== null && pendingOwnQuery === writeTarget
      if (ownsDraft) pendingOwnQuery = null
      // A newer external list owns controls once committed; an older write cannot reset later edits.
      if (ownsDraft && !writeSucceeded && current !== writeStartedAt && current.path.replace(/\/+$/, '') === listPath()) {
        const parsed = parseFinanceListRoute(current.query)
        search.value = parsed.q
        Object.assign(filters, parsed)
      }
    }
  }).catch(() => undefined)
}

watch(debouncedSearch, (value) => {
  if (value.trim() === filters.q.trim()) return
  applyPatch({ q: value })
})
watch([() => filters.kind, () => filters.q, () => filters.offset], () => {
  scheduleQueryWrite()
})
watch(() => route.query, (query) => {
  if (applyingRoute || !isListRoute.value) return
  const parsed = parseFinanceListRoute(query as Record<string, unknown>)
  if (sameFinanceListRoute(serializeFinanceListRoute(filters), serializeFinanceListRoute(parsed))) return
  applyingRoute = true
  search.value = parsed.q
  Object.assign(filters, parsed)
  queueMicrotask(() => { applyingRoute = false })
})
watch(
  () => ({
    fetching: list.isFetching.value,
    offset: filters.offset,
    queryOffset: listFilters.value.offset,
    total: list.data.value?.total,
  }),
  ({ fetching, offset, queryOffset, total }) => {
    if (pendingDeparture || !isListRoute.value) return
    const next = nextOffsetAfterListResult({
      isFetching: fetching,
      requestedOffset: offset,
      responseOffset: queryOffset,
      total,
      pageSize: FINANCE_PAGE,
    })
    if (next === null) return
    applyPatch({ offset: next })
  },
)

function onKindChange(value: unknown) {
  applyPatch({ kind: parseFinanceKind(value) })
}

function clearFilters() {
  search.value = ''
  applyPatch({ q: '', kind: 'all' })
}

function clearSearch() {
  search.value = ''
  applyPatch({ q: '' })
}

function setPage(next: number) {
  if (!hydrated.value || list.isFetching.value || next < 1 || next > pages.value) return
  applyPatch({ offset: (next - 1) * FINANCE_PAGE })
}

const kindItems = computed(() => [
  { value: 'all', label: t('projects.finance.kind.all') },
  { value: 'budget', label: t('projects.finance.kind.budget') },
  { value: 'expense', label: t('projects.finance.kind.expense') },
])
function financeChildKey(target: { path: string; params: Record<string, string | string[]> }) {
  const project = Array.isArray(target.params.id) ? target.params.id[0] : target.params.id
  const entry = Array.isArray(target.params.entryId) ? target.params.entryId[0] : target.params.entryId
  if (entry) return `finance-entry-${project}-${entry}`
  if (target.path.includes('/finance/new')) return `finance-new-${project}`
  return target.path
}
// The list URL as it will be once the debounced search lands: every entry link carries it as its return path.
const liveListPath = computed(() => router.resolve({
  path: `/projects/${projectId.value}/finance`,
  hash: route.hash,
  query: {
    ...serializeFinanceListRoute({ ...filters, q: search.value }),
    ...Object.fromEntries(['returnTo', 'taskContext', 'projectListReturnTo'].filter(key => typeof route.query[key] === 'string').map(key => [key, route.query[key] as string])),
  },
}).fullPath)
const entryTo = (item: { id: number }) => ({ path: `/projects/${projectId.value}/finance/${item.id}`, query: { ...serializeFinanceListRoute({ ...filters, q: search.value }), ...returnToQuery(liveListPath.value) } })
const newTo = (kind: 'budget' | 'expense') => ({ path: `/projects/${projectId.value}/finance/new`, query: { kind, ...returnToQuery(liveListPath.value) } })
const showEmpty = computed(() => !list.isLoading.value && items.value.length === 0)
</script>

<template>
  <template v-if="isListRoute">
    <SharedPageContainer v-if="projectId === null" width="list">
      <p class="text-muted">{{ t('projects.invalidId') }}</p>
    </SharedPageContainer>
    <SharedListPage
      v-else
      hide-header
      data-testid="project-finance-page"
      :title="t('projects.finance.title')"
      :create-to="canManage ? newTo('budget') : undefined"
      :create-label="t('projects.finance.newBudget')"
    >
      <template v-if="canManage" #actions>
        <UButton color="neutral" variant="outline" icon="i-lucide-plus" :disabled="!hydrated" :to="newTo('expense')">{{ t('projects.finance.newExpense') }}</UButton>
      </template>
      <template #filters>
        <FilterBar class="w-full" :active-count="activeFilterCount" :disabled="!hydrated" @clear="clearFilters">
          <template #search>
            <UInput v-model="search" :disabled="!hydrated" :placeholder="t('projects.finance.search')" :aria-label="t('projects.finance.search')" icon="i-lucide-search" data-testid="finance-search" class="w-full min-w-52" />
          </template>
          <template #default>
            <SharedFilterChoice data-testid="finance-kind-filter" layout="segment" :label="t('projects.finance.fields.kind')" :items="kindItems" :model-value="filters.kind" :disabled="!hydrated" @update:model-value="onKindChange" />
          </template>
          <template #active>
            <div v-if="filtered" class="flex flex-wrap items-center gap-2">
              <SharedFilterChip v-if="filters.q.trim()" :label="t('projects.filters.searchValue', { value: filters.q })" @remove="clearSearch" />
              <SharedFilterChip v-if="filters.kind !== 'all'" :label="t(`projects.finance.kind.${filters.kind}`)" @remove="onKindChange('all')" />
            </div>
          </template>
        </FilterBar>
      </template>
      <SharedPageState :loading="list.isLoading.value && !list.data.value" :error="notFound ? null : list.error.value" :empty="false" @retry="list.refetch">
        <p v-if="notFound && !list.isLoading.value" class="text-muted">{{ t('projects.notFound') }}</p>
        <template v-else>
          <FinanceSummaryCards v-if="summary && projectId" :project-id="projectId" :summary="summary" :can-manage="canManage" />
          <SharedEmptyState
            v-if="summary && showEmpty"
            :title="t(filtered ? 'projects.finance.filteredEmpty' : 'projects.finance.empty')"
            :description="t(filtered ? 'projects.finance.filteredEmptyHint' : 'projects.finance.emptyHint')"
          />
          <FinanceEntryTable v-else-if="summary && projectId" :project-id="projectId" :items="items" :summary="summary" :is-loading="list.isLoading.value" :row-to="entryTo" :can-manage="canManage" />
          <SharedPagination :page="page" :pages="pages" :disabled="list.isFetching.value" @update:page="setPage" />
        </template>
      </SharedPageState>
    </SharedListPage>
  </template>
  <KeepAlive>
    <NuxtPage :page-key="financeChildKey" />
  </KeepAlive>
</template>
