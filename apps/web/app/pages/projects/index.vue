<script setup lang="ts">
import { PROJECT_STATUSES } from '@nasq/contracts'
import { refDebounced } from '@vueuse/core'
import { onScopeDispose } from 'vue'
import { onBeforeRouteLeave, type RouteLocationNormalized } from 'vue-router'
import FilterBar from '@/components/shared/FilterBar.vue'
import ProjectTable from '@/components/project/ProjectTable.vue'
import ProjectCards from '@/components/project/ProjectCards.vue'
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
import { returnToQuery } from '@/utils/safeReturnTo'

const router = useRouter()
const route = useRoute()
const { t } = useI18n()
const hydrated = useHydrated()
// Capability probe: full envelope (not minimal) so can_list_archived is set,
// but limit=1 avoids a second 200-row fetch beside the table query.
const activeList = useProjectList(ref(false), { limit: 1 })
const canListArchived = computed(() => activeList.data.value?.can_list_archived ?? false)

const filters = reactive<ProjectListRouteState>(parseProjectListRoute(route.query as Record<string, unknown>))
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
    if (sameProjectListRoute(query, serializeProjectListRoute(parseProjectListRoute(route.query as Record<string, unknown>)))) return
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
watch(() => route.query, (query) => {
  if (applyingRoute) return
  const parsed = parseProjectListRoute(query as Record<string, unknown>)
  const fromRoute = serializeProjectListRoute({ ...parsed, archived: canListArchived.value && parsed.archived })
  if (sameProjectListRoute(serializeProjectListRoute(committedState()), fromRoute)) return
  applyingRoute = true
  // A view switch alone must not discard text typed inside the debounce window.
  if (parsed.q.trim() !== filters.q.trim()) search.value = parsed.q
  Object.assign(filters, { sort: undefined, view: undefined }, parsed)
  queueMicrotask(() => { applyingRoute = false })
})

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
const statusLabel = computed(() => statusOptions.value.find(option => option.value === statusFilter.value)?.label ?? '')
const sortLabel = computed(() => sortOptions.value.find(option => option.value === sort.value)?.label ?? '')
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
    :create-to="createTo"
    :create-label="t('projects.new')"
    create-test-id="project-new"
    :views="views"
  >
    <template #filters>
      <div class="w-full min-w-0" data-testid="projects-toolbar">
        <FilterBar class="w-full" :active-count="activeFilterCount" :disabled="!hydrated" @clear="clearFilters">
          <template #search>
            <UInput v-model="search" :disabled="!hydrated" :placeholder="t('projects.filters.search')" :aria-label="t('projects.filters.search')" icon="i-lucide-search" class="w-full min-w-52" />
          </template>
          <template #default>
            <SharedFilterChoice data-testid="projects-status-filter" :label="t('projects.filters.statusLabel')" :items="statusOptions" :model-value="statusFilter" :disabled="!hydrated" @update:model-value="onStatusChange" />
            <SharedFilterChoice data-testid="projects-sort" layout="segment" :label="t('projects.filters.sortLabel')" :items="sortOptions" :model-value="sort" :disabled="!hydrated" @update:model-value="onSortChange" />
          </template>
          <template #view>
            <UTabs
              v-if="canListArchived"
              :model-value="archived ? 'archived' : 'active'"
              :items="[{ label: t('projects.filters.active'), value: 'active', disabled: !hydrated }, { label: t('projects.filters.archived'), value: 'archived', disabled: !hydrated }]"
              size="sm"
              @update:model-value="onFilterChange"
            />
          </template>
          <template #active>
            <div v-if="rawSearch || statusFilter !== 'all' || sort !== 'default'" class="flex flex-wrap items-center gap-2">
              <SharedFilterChip v-if="rawSearch" :label="t('projects.filters.searchValue', { value: rawSearch })" @remove="clearSearch" />
              <SharedFilterChip v-if="statusFilter !== 'all'" :label="statusLabel" @remove="onStatusChange('all')" />
              <SharedFilterChip v-if="sort !== 'default'" :label="sortLabel" @remove="onSortChange('default')" />
            </div>
          </template>
        </FilterBar>
      </div>
    </template>

    <template #default="{ view }">
      <UAlert
        v-if="activeList.error.value && !projectList.error.value"
        role="alert"
        color="error"
        variant="subtle"
        icon="i-lucide-circle-alert"
        :title="t('projects.loadError')"
      >
        <template #actions>
          <UButton color="neutral" variant="outline" size="sm" :disabled="!hydrated" :label="t('app.retry')" @click="activeList.refetch()" />
        </template>
      </UAlert>

      <SharedPageState v-if="projectList.error.value" :error="projectList.error.value" @retry="projectList.refetch" />
      <div v-else class="grid gap-3">
        <p v-if="projectList.data.value" data-testid="projects-result-count" class="text-sm text-muted">
          {{ t('projects.refresh.workspace.resultCount', { count: total }) }}
        </p>
        <SharedEmptyState v-if="showEmpty" :title="t(`projects.${emptyKey}`)" :description="t(`projects.${emptyKey}Hint`)" />
        <ProjectTable v-else-if="view === 'table'" :items="displayedItems" :is-loading="isLoading" :to-for="projectTo" @open="openProject" />
        <ProjectCards v-else :items="displayedItems" :is-loading="isLoading" :to-for="projectTo" @open="openProject" />
        <SharedPagination :page="page" :pages="pages" :disabled="projectList.isFetching.value" @update:page="setPage" />
      </div>
    </template>
  </SharedListPage>
</template>
