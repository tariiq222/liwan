<script setup lang="ts">
import { PROJECT_STATUSES } from '@webvue/contracts'
import { refDebounced } from '@vueuse/core'
import { onScopeDispose } from 'vue'
import { onBeforeRouteLeave, type RouteLocationNormalized } from 'vue-router'
import FilterBar from '@webvue/ui/app/components/shared/data/FilterBar.vue'
import ProjectTable from '@/components/pmo/projects/ProjectTable.vue'
import ProjectCards from '@/components/pmo/projects/ProjectCards.vue'
import ProjectKpiStrip from '@/components/pmo/projects/ProjectKpiStrip.vue'
import {
  PROJECT_PAGE,
  parseProjectListRoute,
  parseProjectListStatus,
  patchProjectListRoute,
  sameProjectListRoute,
  serializeProjectListRoute,
  useProjectList,
  type ProjectListRouteState,
} from '@/composables/useProjects'
import { listFilterQuery } from '@/composables/useRouteListFilters'
import { returnToQuery, safeReturnTo } from '@webvue/ui/app/utils/safeReturnTo'

const router = useRouter()
const route = useRoute()
const { t } = useI18n()
const hydrated = useHydrated()
const { shown: kpisShown } = useKpiVisibility()
// Capability probe: full envelope (not minimal) so can_list_archived is set,
// but limit=1 avoids a second 200-row fetch beside the table query.
const activeList = useProjectList(ref(false), { limit: 1 })
const canListArchived = computed(() => activeList.data.value?.can_list_archived ?? false)

// Behind the /projects/new panel this page is only the backdrop: its filters travel in the panel's `returnTo`.
const background = computed(() => (route.path.replace(/\/+$/, '') || '/') === '/projects/new')
const listQuery = computed(() => listFilterQuery(route.query, background.value, '/projects', (value, fallback) => safeReturnTo(value, fallback, ['/projects'])))
const filters = reactive<ProjectListRouteState>(parseProjectListRoute(listQuery.value))
const search = ref(filters.q)
const debouncedSearch = refDebounced(search, 250)
let applyingRoute = false
let writeQuery: Promise<void> = Promise.resolve()
let pendingDeparture: RouteLocationNormalized | null = null

// A background row or create link may start a slow navigation before the
// debounce commits. A later list replace would cancel that outgoing navigation.
onBeforeRouteLeave(to => { pendingDeparture = to })
function resumeListWrites() {
  pendingDeparture = null
  // A rejected or superseded departure keeps the list alive. Commit any
  // filter write that was paused, and let subsequent edits update its URL.
  if ((router.currentRoute.value.path.replace(/\/+$/, '') || '/') === '/projects') void scheduleQueryWrite()
}
const stopAfterEach = router.afterEach((to, _from, failure) => {
  if (!pendingDeparture) return
  // Two attempts can share a fullPath; only the current public route object
  // can release the pause when its own navigation fails.
  const failedDeparture = failure && to === pendingDeparture
  const returnedToList = !failure && (to.path.replace(/\/+$/, '') || '/') === '/projects'
  if (!failedDeparture && !returnedToList) return
  resumeListWrites()
})
// Thrown guards and failed lazy imports reject through onError, skipping
// afterEach. Release this departure's pause without consuming the error.
const stopOnError = router.onError((_error, to) => {
  if (to === pendingDeparture) resumeListWrites()
})
onScopeDispose(() => { stopAfterEach(); stopOnError() })

function committedState(): ProjectListRouteState {
  return {
    q: filters.q,
    mine: filters.mine,
    status: filters.status,
    offset: filters.offset,
    archived: canListArchived.value && filters.archived,
    sort: filters.sort,
    view: filters.view,
  }
}

function applyPatch(patch: Partial<ProjectListRouteState>) {
  Object.assign(filters, patchProjectListRoute(filters, patch))
}

function scheduleQueryWrite(): Promise<void> {
  writeQuery = writeQuery.then(async () => {
    if (pendingDeparture || (route.path.replace(/\/+$/, '') || '/') !== '/projects') return
    const query = serializeProjectListRoute(committedState())
    if (sameProjectListRoute(query, serializeProjectListRoute(parseProjectListRoute(listQuery.value)))) return
    applyingRoute = true
    try {
      await router.replace({ query })
    } finally {
      applyingRoute = false
    }
  }).catch(() => undefined)
  return writeQuery
}

// Never resolve to true unless the server says this user may list archived
// projects — a manager-gated 403 must never reach useProjectList, or an
// employee following a stale/shared `?archived=1` link sees a silent empty
// table instead of the active list.
const archived = computed(() => canListArchived.value && filters.archived)
const rawSearch = computed(() => filters.q)
const statusFilter = computed(() => filters.status)
const listOffset = computed(() => filters.offset)
const listFilters = computed(() => ({
  q: filters.q.trim() || undefined,
  mine: filters.mine,
  status: filters.status === 'all' ? undefined : filters.status,
  sort: filters.sort,
  limit: PROJECT_PAGE,
  offset: filters.offset,
}))
const projectList = useProjectList(archived, listFilters)
// The KPI strip counts what the filters select, across every page; archived projects have no strip.
const summaryFilters = computed(() => ({ q: filters.q, mine: filters.mine, status: filters.status === 'all' ? undefined : filters.status }))
const items = computed(() => projectList.data.value?.items ?? [])
type CapabilityOutcome = { at: number; allowed: boolean }
const latestCapability = ref<CapabilityOutcome>({ at: 0, allowed: false })

function recordCapabilityOutcome(at: number, allowed: boolean) {
  const current = latestCapability.value
  if (at > current.at || (at === current.at && current.allowed && !allowed)) {
    latestCapability.value = { at, allowed }
  }
}

function watchCapability(query: ReturnType<typeof useProjectList>) {
  watch(
    [() => query.dataUpdatedAt.value, () => query.data.value?.can_create],
    ([at, allowed]) => {
      if (typeof at === 'number' && at > 0 && typeof allowed === 'boolean') recordCapabilityOutcome(at, allowed)
    },
    { immediate: true, flush: 'sync' },
  )
  watch(
    [() => query.errorUpdatedAt.value, () => query.error.value],
    ([at, error]) => {
      if (error && typeof at === 'number' && at > 0) recordCapabilityOutcome(at, false)
    },
    { immediate: true, flush: 'sync' },
  )
}

watchCapability(activeList)
watchCapability(projectList)

// Keep the latest server outcome across query-key changes. Cached page data
// can be older than a denial or error observed on another page; only a newer
// response may grant the action again. Refetches retain the current outcome so
// an authorized button does not flicker while a request is in flight.
const canCreate = computed(() => latestCapability.value.allowed)
// The list URL as it will be once the debounced search lands. The create link and every project link
// carry it as their return path, so a project opened inside the 250ms debounce still returns to the
// filtered list. The route itself catches up on its own.
// A changed search resets the offset exactly as the debounced commit will, so the live state is the
// committed one patched with the typed search.
const liveState = computed<ProjectListRouteState>(() => search.value.trim() === filters.q.trim()
  ? committedState()
  : { ...patchProjectListRoute(filters, { q: search.value }), archived: committedState().archived })
const liveListPath = computed(() => router.resolve({ path: '/projects', query: serializeProjectListRoute(liveState.value) }).fullPath)
const createTo = computed(() => canCreate.value ? { path: '/projects/new', query: returnToQuery(liveListPath.value) } : undefined)
// The switch lives in SharedListPage and writes ?view= itself. Cards, the first option, is the bare URL.
const views = computed(() => [
  { value: 'cards', label: t('projects.filters.cardView'), icon: 'i-lucide-layout-grid', testId: 'projects-view-cards' },
  { value: 'table', label: t('projects.filters.tableView'), icon: 'i-lucide-list', testId: 'projects-view-table' },
])
const total = computed(() => projectList.data.value?.total ?? 0)
// The list's total as a tag in the heading, once the first page has arrived.
const countTags = computed(() => projectList.data.value ? [{ label: t('projects.countTag', { count: total.value }, total.value), kind: 'count' as const }] : [])
const page = computed(() => Math.floor(listOffset.value / PROJECT_PAGE) + 1)
const pages = computed(() => Math.max(1, Math.ceil(total.value / PROJECT_PAGE)))
watch(debouncedSearch, (value) => {
  if (value.trim() === filters.q.trim()) return
  applyPatch({ q: value })
})
watch(
  [() => filters.q, () => filters.mine, () => filters.status, () => filters.offset, () => canListArchived.value && filters.archived, () => filters.sort, () => filters.view],
  () => {
    scheduleQueryWrite()
  },
)
watch(listQuery, (query) => {
  if (applyingRoute) return
  const parsed = parseProjectListRoute(query)
  const fromRoute = serializeProjectListRoute({ ...parsed, archived: canListArchived.value && parsed.archived })
  if (sameProjectListRoute(serializeProjectListRoute(committedState()), fromRoute)) return
  applyingRoute = true
  // A view switch alone must not discard text typed inside the debounce window.
  if (parsed.q.trim() !== filters.q.trim()) search.value = parsed.q
  Object.assign(filters, { sort: undefined, view: undefined }, parsed)
  queueMicrotask(() => { applyingRoute = false })
})

// «كل المشاريع» links and older bookmarks may ask for `?view=list`: that is the table view, so settle on `table`
// and keep every other query value.
watch(() => route.query.view, (view) => {
  if (view !== 'list' || (route.path.replace(/\/+$/, '') || '/') !== '/projects') return
  void navigateTo({ path: route.path, query: { ...route.query, view: 'table' }, hash: route.hash }, { replace: true })
}, { immediate: true })

function onStatusChange(value: unknown) {
  applyPatch({ status: parseProjectListStatus(value) })
}
function clearFilters() {
  search.value = ''
  applyPatch({ q: '', status: 'all', sort: 'default' })
}
const sort = computed(() => filters.sort ?? 'default')
const activeFilterCount = computed(() => Number(Boolean(rawSearch.value.trim())) + Number(statusFilter.value !== 'all') + Number(sort.value !== 'default'))
function onSortChange(value: unknown) {
  applyPatch({ sort: value === 'name' || value === 'progress' ? value : 'default' })
}
const statusOptions = computed(() => [
  { value: 'all', label: t('projects.filters.allStatuses') },
  ...PROJECT_STATUSES.map(status => ({ value: status, label: t(`projects.status.${status}`) })),
  { value: 'unset', label: t('projects.filters.unset') },
])
const sortOptions = computed(() => [
  { value: 'default', label: t('projects.filters.sortDefault') },
  { value: 'name', label: t('projects.filters.sortName') },
  { value: 'progress', label: t('projects.filters.sortProgress') },
])
function clearSearch() {
  search.value = ''
  applyPatch({ q: '' })
}
// Ordering belongs to the server, before pagination.
const displayedItems = items
const isLoading = computed(() => projectList.isLoading.value)
// The empty state keeps its title and its hint, so the page draws it, not the table.
const emptyKey = computed(() => (Boolean(rawSearch.value.trim()) || statusFilter.value !== 'all') ? 'filteredEmpty' : archived.value ? 'archivedEmpty' : 'empty')
const showEmpty = computed(() => !isLoading.value && items.value.length === 0)

const scopes = computed(() => [
  { value: 'active', label: t('projects.filters.active') },
  { value: 'archived', label: t('projects.filters.archived') },
])
function onFilterChange(v: unknown) {
  applyPatch({ archived: v === 'archived' })
}
function setPage(next: number) {
  if (!hydrated.value || projectList.isFetching.value || next < 1 || next > pages.value) return
  applyPatch({ offset: (next - 1) * PROJECT_PAGE })
}

async function flushPendingSearch() {
  if (search.value.trim() !== filters.q.trim()) applyPatch({ q: search.value })
  await scheduleQueryWrite()
}

const { entryTo } = useProjectWorkspaceMemory()
function projectTo(project: { id: number; active: boolean }) {
  return entryTo(project.id, liveListPath.value, project.active)
}
async function openProject(id: number) {
  const origin = liveListPath.value
  await flushPendingSearch()
  const project = items.value.find(item => item.id === id)
  router.push(entryTo(id, origin, project?.active ?? true))
}
</script>

<template>
  <SharedListPage
    :title="t(filters.mine ? 'nav.myProjects' : 'nav.allProjects')"
    :tags="countTags"
    :create-to="createTo"
    :create-label="t('projects.new')"
    create-test-id="project-new"
    :views="views"
    views-in-filters
    :kpi-toggle="!archived"
  >
    <template #default="{ view }">
      <!-- The list's controls and rows carry client-generated ids, and the query data can land before hydration starts. Mount the
           card (filters inside it) only once this page has hydrated, so server and client never disagree about its tree and no
           control's first click is lost; the toolbar's controls stay disabled until then. One card and one filter row serve both
           views: switching only swaps what is under the row. -->
      <ProjectKpiStrip v-if="hydrated && kpisShown && !archived" :filters="summaryFilters" />
      <SharedListCard v-if="hydrated">
        <template #filters>
          <div class="w-full min-w-0" data-testid="projects-toolbar">
            <FilterBar embedded class="w-full" :active-count="activeFilterCount" :disabled="!hydrated" @clear="clearFilters">
              <template #search>
                <UInput v-model="search" :disabled="!hydrated" :placeholder="t('projects.filters.search')" :aria-label="t('projects.filters.search')" icon="i-lucide-search" class="min-w-48 flex-1">
                  <template v-if="search" #trailing>
                    <UButton type="button" color="neutral" variant="link" size="sm" icon="i-lucide-x" :aria-label="t('projects.filters.clearSearch')" class="-me-1" @click="clearSearch" />
                  </template>
                </UInput>
              </template>
              <template #default>
                <USelect
                  class="w-full md:w-44"
                  data-testid="projects-status-filter"
                  :disabled="!hydrated"
                  :items="statusOptions"
                  :model-value="statusFilter"
                  :aria-label="t('projects.filters.statusLabel')"
                  @update:model-value="onStatusChange"
                />
                <USelect
                  class="w-full md:w-48"
                  data-testid="projects-sort"
                  :disabled="!hydrated"
                  :items="sortOptions"
                  :model-value="sort"
                  :aria-label="t('projects.filters.sortLabel')"
                  @update:model-value="onSortChange"
                />
              </template>
              <template #view>
                <SharedSegmentedControl
                  v-if="canListArchived"
                  data-testid="projects-scope"
                  :label="t('projects.filters.scopeLabel')"
                  :items="scopes"
                  :model-value="archived ? 'archived' : 'active'"
                  @update:model-value="onFilterChange"
                />
              </template>
            </FilterBar>
          </div>
        </template>

        <UAlert
          v-if="activeList.error.value && !projectList.error.value"
          role="alert"
          color="error"
          variant="subtle"
          icon="i-lucide-circle-alert"
          class="m-(--webvue-card-pad-dense)"
          :title="t('projects.loadError')"
        >
          <template #actions>
            <UButton color="neutral" variant="outline" size="sm" :disabled="!hydrated" :label="t('app.retry')" @click="activeList.refetch()" />
          </template>
        </UAlert>

        <SharedPageState :error="projectList.error.value" :keep-content="displayedItems.length > 0" @retry="projectList.refetch">
          <SharedEmptyState v-if="showEmpty" class="m-(--webvue-card-pad-dense)" :title="t(`projects.${emptyKey}`)" :description="t(`projects.${emptyKey}Hint`)" />
          <ProjectTable v-else-if="view === 'table'" :items="displayedItems" :is-loading="isLoading" :to-for="projectTo" @open="openProject" />
          <ProjectCards v-else :items="displayedItems" :is-loading="isLoading" :to-for="projectTo" @open="openProject" />
        </SharedPageState>
        <template v-if="projectList.data.value && !showEmpty" #footer>
          <SharedListFooter :count-label="t('projects.footer.results', { shown: displayedItems.length, total }, total)" count-test-id="projects-result-count" :page="page" :pages="pages" :disabled="projectList.isFetching.value" @update:page="setPage" />
        </template>
      </SharedListCard>
      <SharedLoadingSkeleton v-else variant="rows" />
    </template>
  </SharedListPage>
</template>
