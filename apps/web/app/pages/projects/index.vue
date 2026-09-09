<script setup lang="ts">
import { PROJECT_STATUSES } from '@nasq/contracts'
import { LayoutGrid, List, Plus, Search } from '@lucide/vue'
import { refDebounced } from '@vueuse/core'
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
    { immediate: true },
  )
  watch(
    [() => query.errorUpdatedAt.value, () => query.error.value],
    ([at, error]) => {
      if (error && typeof at === 'number' && at > 0) recordCapabilityOutcome(at, false)
    },
    { immediate: true },
  )
}

watchCapability(activeList)
watchCapability(projectList)

// Keep the latest server outcome across query-key changes. Cached page data
// can be older than a denial or error observed on another page; only a newer
// response may grant the action again. Refetches retain the current outcome so
// an authorized button does not flicker while a request is in flight.
const canCreate = computed(() => latestCapability.value.allowed)
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
  search.value = parsed.q
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
const view = computed(() => filters.view ?? 'table')
const activeFilterCount = computed(() => Number(Boolean(rawSearch.value.trim())) + Number(statusFilter.value !== 'all') + Number(sort.value !== 'default'))
function onSortChange(value: unknown) {
  applyPatch({ sort: value === 'name' || value === 'progress' ? value : 'default' })
}
function onViewChange(value: 'table' | 'cards') { applyPatch({ view: value }) }
// Ordering belongs to the server, before pagination.
const displayedItems = items
const isLoading = computed(() => projectList.isLoading.value)

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

async function openCreate() {
  await flushPendingSearch()
  const returnPath = router.resolve({
    path: '/projects',
    query: serializeProjectListRoute(committedState()),
  }).fullPath
  router.push({ path: '/projects/new', query: returnToQuery(returnPath) })
}
function openProject(id: number) {
  router.push({ path: `/projects/${id}`, query: returnToQuery(route.fullPath) })
}
</script>

<template>
  <SharedPageContainer width="list">
    <SharedPageHeader :title="t(filters.mine ? 'nav.myProjects' : 'nav.allProjects')" :description="t(filters.mine ? 'projects.myDescription' : 'projects.description')">
      <template #actions>
        <Button as-child variant="outline">
          <NuxtLink :to="{ path: '/projects/dashboard', query: returnToQuery(route.fullPath) }" data-testid="projects-dashboard-link">
            {{ t('nav.projectDashboard') }}
          </NuxtLink>
        </Button>
        <Button v-if="canCreate" data-testid="project-new" :disabled="!hydrated" class="gap-2" @click="openCreate">
          <Plus class="size-[18px]" />{{ t('projects.new') }}
        </Button>
        <Button as-child variant="outline">
          <NuxtLink :to="{ path: '/project-templates', query: returnToQuery(route.fullPath) }" data-testid="project-templates-link">
            {{ t('projects.planningLinks.templates') }}
          </NuxtLink>
        </Button>
      </template>
    </SharedPageHeader>
    <div v-if="activeList.error.value && !projectList.error.value" role="alert" class="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
      <span>{{ t('projects.loadError') }}</span>
      <Button variant="outline" size="sm" @click="activeList.refetch()">{{ t('app.retry') }}</Button>
    </div>
    <div class="w-full min-w-0" data-testid="projects-toolbar">
      <FilterBar class="w-full" :active-count="activeFilterCount" :disabled="!hydrated" @clear="clearFilters">
      <template #search>
        <div class="relative min-w-52 flex-1">
          <Search class="pointer-events-none absolute start-2 top-1/2 size-[18px] -translate-y-1/2 text-muted-foreground" />
          <Input v-model="search" :disabled="!hydrated" :placeholder="t('projects.filters.search')" class="ps-8" />
        </div>
      </template>

      <template #default>
        <Tabs v-if="canListArchived" :model-value="archived ? 'archived' : 'active'" @update:model-value="onFilterChange">
          <TabsList>
            <TabsTrigger value="active" :disabled="!hydrated">{{ t('projects.filters.active') }}</TabsTrigger>
            <TabsTrigger value="archived" :disabled="!hydrated">{{ t('projects.filters.archived') }}</TabsTrigger>
          </TabsList>
        </Tabs>
        <Select :model-value="statusFilter" @update:model-value="onStatusChange">
          <SelectTrigger data-testid="projects-status-filter" class="w-40" :disabled="!hydrated">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{{ t('projects.filters.allStatuses') }}</SelectItem>
            <SelectItem value="unset">{{ t('projects.filters.unset') }}</SelectItem>
            <SelectItem v-for="status in PROJECT_STATUSES" :key="status" :value="status">{{ t(`projects.status.${status}`) }}</SelectItem>
          </SelectContent>
        </Select>
        <Select :model-value="sort" @update:model-value="onSortChange">
          <SelectTrigger data-testid="projects-sort" class="w-40" :disabled="!hydrated">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="default">{{ t('projects.filters.sortDefault') }}</SelectItem>
            <SelectItem value="name">{{ t('projects.filters.sortName') }}</SelectItem>
            <SelectItem value="progress">{{ t('projects.filters.sortProgress') }}</SelectItem>
          </SelectContent>
        </Select>
      </template>
      <template #view>
        <div role="group" class="inline-flex h-[40px] items-center rounded-lg border bg-muted/40 p-0.5" :aria-label="t('projects.filters.view')">
          <Button data-testid="projects-view-table" type="button" variant="ghost" size="icon" class="size-[32px] rounded-md" :class="view === 'table' ? 'bg-background shadow-sm' : ''" :disabled="!hydrated" :aria-label="t('projects.filters.tableView')" :aria-pressed="view === 'table'" @click="onViewChange('table')">
            <List class="size-[18px]" />
          </Button>
          <Button data-testid="projects-view-cards" type="button" variant="ghost" size="icon" class="size-[32px] rounded-md" :class="view === 'cards' ? 'bg-background shadow-sm' : ''" :disabled="!hydrated" :aria-label="t('projects.filters.cardView')" :aria-pressed="view === 'cards'" @click="onViewChange('cards')">
            <LayoutGrid class="size-[18px]" />
          </Button>
        </div>
      </template>

      <template #active>
        <div v-if="rawSearch || statusFilter !== 'all' || sort !== 'default'" class="flex flex-wrap items-center gap-2">
          <Badge v-if="rawSearch" variant="secondary">{{ t('projects.filters.searchValue', { value: rawSearch }) }}</Badge>
          <Badge v-if="statusFilter !== 'all'" variant="secondary">{{ t(statusFilter === 'unset' ? 'projects.filters.unset' : `projects.status.${statusFilter}`) }}</Badge>
          <Badge v-if="sort !== 'default'" variant="secondary">{{ t(sort === 'name' ? 'projects.filters.sortName' : 'projects.filters.sortProgress') }}</Badge>
        </div>
      </template>
      </FilterBar>
    </div>

    <SharedPageState v-if="projectList.error.value" :error="projectList.error.value" @retry="projectList.refetch" />
    <template v-else>
    <p v-if="projectList.data.value" data-testid="projects-result-count" class="text-sm text-muted-foreground">
      {{ t('projects.refresh.workspace.resultCount', { count: total }) }}
    </p>
    <ProjectTable
      v-if="view === 'table'"
      :items="displayedItems"
      :capped="false"
      :filtered="Boolean(rawSearch.trim()) || statusFilter !== 'all'"
      :is-loading="isLoading"
      :archived="archived"
      @open="openProject"
    />
    <ProjectCards
      v-else
      :items="displayedItems"
      :is-loading="isLoading"
      :filtered="Boolean(rawSearch.trim()) || statusFilter !== 'all'"
      :archived="archived"
      :capped="false"
      @open="openProject"
    />
      <div v-if="pages > 1" class="flex items-center justify-between text-sm text-muted-foreground">
        <Button variant="ghost" :disabled="!hydrated || page === 1 || projectList.isFetching.value" @click="setPage(page - 1)">
          {{ t('projects.previousPage') }}
        </Button>
        <span>{{ t('projects.pageOf', { page, pages }) }}</span>
        <Button variant="ghost" :disabled="!hydrated || page >= pages || projectList.isFetching.value" @click="setPage(page + 1)">
          {{ t('projects.nextPage') }}
        </Button>
      </div>
    </template>
  </SharedPageContainer>
</template>
