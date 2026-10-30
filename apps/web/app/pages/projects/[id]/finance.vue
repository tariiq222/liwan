<script setup lang="ts">
import type { RouteLocationNormalized } from 'vue-router'
import { refDebounced } from '@vueuse/core'
import { ApiError } from '@/composables/useApi'
import { useProjectFinanceList } from '@/composables/useProjectFinance'
import { useProject } from '@/composables/useProjects'
import ProjectNotFoundState from '@/components/pmo/projects/ProjectNotFoundState.vue'
import FinanceActualLines from '@/components/pmo/projects/finance/FinanceActualLines.vue'
import FinanceEntryTable from '@/components/pmo/projects/finance/FinanceEntryTable.vue'
import FinanceSummaryCards from '@/components/pmo/projects/finance/FinanceSummaryCards.vue'
import FilterBar from '@webvue/ui/app/components/shared/data/FilterBar.vue'
import {
  FINANCE_PAGE,
  financeKindFilters,
  isExternalActual,
  ledgerEmptiness,
  parseFinanceKind,
  parseFinanceListRoute,
  patchFinanceListRoute,
  nextOffsetAfterListResult,
  sameFinanceListRoute,
  serializeFinanceListRoute,
  type FinanceListRouteState,
} from '@/utils/projectFinance'
import { parsePositiveId } from '@/utils/routeParams'
import { listFilterQuery } from '@/composables/useRouteListFilters'
import { returnToQuery, safeReturnTo } from '@webvue/ui/app/utils/safeReturnTo'

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

// Behind the /new panel this page is only the backdrop: its filters travel in the panel's `returnTo`, and its own `?kind=` is the new entry's.
const listQuery = computed(() => listFilterQuery(route.query, normalizedPath.value.endsWith('/new'), `/projects/${projectId.value}/finance`, (value, fallback) => safeReturnTo(value, fallback, ['/projects'])))
const filters = reactive<FinanceListRouteState>(parseFinanceListRoute(listQuery.value))
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
const stopNavigationStart = useNuxtApp().hook('webvue:navigation:start', to => {
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
    if (sameFinanceListRoute(query, serializeFinanceListRoute(parseFinanceListRoute(listQuery.value)))) return
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
watch(listQuery, (query) => {
  if (applyingRoute || !isListRoute.value) return
  const parsed = parseFinanceListRoute(query)
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

const external = computed(() => summary.value ? isExternalActual(summary.value) : false)
const kindItems = computed(() => financeKindFilters(summary.value).map(value => ({ value, label: t(`projects.finance.kind.${value}`) })))
// An external actual has no manual expenses: a link that still asks for them shows every entry instead.
watch([external, () => filters.kind], ([isExternal, kind]) => {
  if (isExternal && kind === 'expense') applyPatch({ kind: 'all' })
}, { immediate: true })
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
// A ledger with nothing in it and nothing filtered is an empty page, not an empty list: no filter row to show.
const emptiness = computed(() => summary.value
  ? ledgerEmptiness({ ledgerEmpty: showEmpty.value, filtered: filtered.value, offset: filters.offset, summary: summary.value })
  : 'none')
</script>

<template>
  <template v-if="isListRoute">
    <ProjectNotFoundState v-if="projectId === null" />
    <SharedListPage
      v-else
      hide-header
      data-testid="project-finance-page"
      :title="t('projects.finance.title')"
      :create-to="canManage ? newTo('budget') : undefined"
      :create-label="t('projects.finance.newBudget')"
    >
      <template v-if="canManage && !external" #actions>
        <UButton color="neutral" variant="outline" icon="i-lucide-plus" :disabled="!hydrated" :to="newTo('expense')">{{ t('projects.finance.newExpense') }}</UButton>
      </template>
      <ProjectNotFoundState v-if="notFound && !list.isLoading.value" embedded />
      <template v-else>
        <FinanceSummaryCards v-if="summary && projectId" :project-id="projectId" :summary="summary" />
        <SharedEmptyState v-if="emptiness === 'bare'" bordered :title="t('projects.finance.empty')" :description="canManage ? t('projects.finance.emptyHint') : undefined" />
        <SharedListCard v-else-if="emptiness === 'none'">
          <template #filters>
            <FilterBar embedded class="w-full" :active-count="activeFilterCount" :disabled="!hydrated" @clear="clearFilters">
              <template #search>
                <UInput v-model="search" :disabled="!hydrated" :placeholder="t('projects.finance.search')" :aria-label="t('projects.finance.search')" icon="i-lucide-search" data-testid="finance-search" class="w-full min-w-52">
                  <template v-if="search" #trailing>
                    <UButton type="button" color="neutral" variant="link" size="sm" icon="i-lucide-x" :aria-label="t('projects.filters.clearSearch')" class="-me-1" @click="clearSearch" />
                  </template>
                </UInput>
              </template>
              <template #view>
                <SharedSegmentedControl data-testid="finance-kind-filter" :label="t('projects.finance.fields.kind')" :items="kindItems" :model-value="filters.kind" :disabled="!hydrated" @update:model-value="onKindChange" />
              </template>
            </FilterBar>
          </template>
          <SharedPageState :loading="list.isLoading.value && !list.data.value" :error="notFound ? null : list.error.value" :empty="false" @retry="list.refetch">
            <div v-if="summary && showEmpty" class="p-(--webvue-card-pad)">
              <SharedEmptyState :title="t('projects.finance.filteredEmpty')" :description="t('projects.finance.filteredEmptyHint')" />
            </div>
            <FinanceEntryTable v-else-if="summary && projectId" :project-id="projectId" :items="items" :summary="summary" :is-loading="list.isLoading.value" :row-to="entryTo" :can-manage="canManage" />
          </SharedPageState>
          <template v-if="summary && items.length" #footer>
            <SharedListFooter :count-label="t('projects.footer.results', { shown: items.length, total }, total)" count-test-id="finance-result-count" :page="page" :pages="pages" :disabled="list.isFetching.value" @update:page="setPage" />
          </template>
        </SharedListCard>
        <FinanceActualLines v-if="summary?.can_read_actual_lines && projectId" :project-id="projectId" :summary="summary" />
      </template>
    </SharedListPage>
  </template>
  <KeepAlive>
    <NuxtPage :page-key="financeChildKey" />
  </KeepAlive>
</template>
