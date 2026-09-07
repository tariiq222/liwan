<script setup lang="ts">
import { PROJECT_STATUSES } from '@nasq/contracts'
import { CircleAlert, CircleCheck, Eye, EyeOff, FolderKanban, LayoutGrid, List, Plus, Search, X } from '@lucide/vue'
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
usePageHeader(() => t('projects.title'), () => t('projects.description'))

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

function scheduleQueryWrite() {
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
  status: filters.status === 'all' ? undefined : filters.status,
  sort: filters.sort,
  limit: PROJECT_PAGE,
  offset: filters.offset,
}))
const projectList = useProjectList(archived, listFilters)
const items = computed(() => projectList.data.value?.items ?? [])
const canCreate = computed(() => projectList.data.value?.can_create ?? false)
const total = computed(() => projectList.data.value?.total ?? 0)
const page = computed(() => Math.floor(listOffset.value / PROJECT_PAGE) + 1)
const pages = computed(() => Math.max(1, Math.ceil(total.value / PROJECT_PAGE)))
const summaryVisible = ref(true)
const summaryStorageKey = 'nasq.projects.summary-visible'
const summary = computed(() => ({
  displayed: items.value.length,
  attention: items.value.filter(project => project.status === 'at_risk' || project.status === 'off_track' || project.status === 'on_hold').length,
  completed: items.value.filter(project => project.status === 'done').length,
  tasks: items.value.reduce((total, project) => total + project.task_count, 0),
  attentionOpen: items.value
    .filter(project => project.status === 'at_risk' || project.status === 'off_track' || project.status === 'on_hold')
    .reduce((total, project) => total + Math.max(0, project.task_count - project.closed_task_count), 0),
  completedTasks: items.value
    .filter(project => project.status === 'done')
    .reduce((total, project) => total + project.closed_task_count, 0),
}))

watch(debouncedSearch, (value) => {
  if (value.trim() === filters.q.trim()) return
  applyPatch({ q: value })
})
watch(
  [() => filters.q, () => filters.status, () => filters.offset, () => canListArchived.value && filters.archived, () => filters.sort, () => filters.view],
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
function onSortChange(value: unknown) {
  applyPatch({ sort: value === 'name' || value === 'progress' ? value : 'default' })
}
function onViewChange(value: 'table' | 'cards') { applyPatch({ view: value }) }
// Ordering belongs to the server, before pagination.
const displayedItems = items
const isLoading = computed(() => projectList.isLoading.value)

onMounted(() => {
  const saved = window.localStorage.getItem(summaryStorageKey)
  if (saved === 'hidden' || saved === 'visible') summaryVisible.value = saved === 'visible'
})
watch(summaryVisible, (visible) => {
  if (import.meta.client) window.localStorage.setItem(summaryStorageKey, visible ? 'visible' : 'hidden')
})

function onFilterChange(v: unknown) {
  applyPatch({ archived: v === 'archived' })
}
function setPage(next: number) {
  if (!hydrated.value || projectList.isFetching.value || next < 1 || next > pages.value) return
  applyPatch({ offset: (next - 1) * PROJECT_PAGE })
}

function openCreate() {
  router.push({ path: '/projects/new', query: returnToQuery(route.fullPath) })
}
function openProject(id: number) {
  router.push({ path: `/projects/${id}`, query: returnToQuery(route.fullPath) })
}
</script>

<template>
  <SharedPageContainer width="list">
    <section data-testid="projects-summary" class="space-y-2">
      <div class="flex items-center justify-end">
        <Button
          variant="ghost"
          size="icon"
          class="size-[32px] rounded-lg border border-border"
          :disabled="!hydrated"
          :aria-label="t(summaryVisible ? 'projects.summary.hide' : 'projects.summary.show')"
          :aria-pressed="summaryVisible"
          @click="summaryVisible = !summaryVisible"
        >
          <EyeOff v-if="summaryVisible" class="size-[18px]" />
          <Eye v-else class="size-[18px]" />
        </Button>
      </div>
      <div v-if="summaryVisible" data-testid="projects-summary-cards" class="grid gap-3 sm:grid-cols-3">
        <div class="flex items-center gap-3 rounded-lg border bg-card p-4">
          <span class="grid size-[32px] shrink-0 place-items-center rounded-lg border bg-muted text-muted-foreground"><FolderKanban class="size-[18px]" /></span>
          <div class="min-w-0">
            <p class="text-xs text-muted-foreground">{{ t('projects.summary.displayed') }}</p>
            <div class="mt-1 flex flex-wrap items-baseline gap-2">
              <p data-testid="projects-summary-displayed" class="text-2xl font-semibold tabular-nums">{{ summary.displayed }}</p>
              <p class="text-[11px] text-muted-foreground">{{ t('projects.summary.tasks', { count: summary.tasks }) }}</p>
            </div>
          </div>
        </div>
        <div class="flex items-center gap-3 rounded-lg border bg-card p-4">
          <span class="nasq-status-icon-warning grid size-[32px] shrink-0 place-items-center rounded-lg"><CircleAlert class="size-[18px]" /></span>
          <div class="min-w-0">
            <p class="text-xs text-muted-foreground">{{ t('projects.summary.attention') }}</p>
            <div class="mt-1 flex flex-wrap items-baseline gap-2">
              <p data-testid="projects-summary-attention" class="text-2xl font-semibold tabular-nums">{{ summary.attention }}</p>
              <p class="text-[11px] text-muted-foreground">{{ t('projects.summary.remaining', { count: summary.attentionOpen }) }}</p>
            </div>
          </div>
        </div>
        <div class="flex items-center gap-3 rounded-lg border bg-card p-4">
          <span class="nasq-status-icon-success grid size-[32px] shrink-0 place-items-center rounded-lg"><CircleCheck class="size-[18px]" /></span>
          <div class="min-w-0">
            <p class="text-xs text-muted-foreground">{{ t('projects.summary.completed') }}</p>
            <div class="mt-1 flex flex-wrap items-baseline gap-2">
              <p data-testid="projects-summary-completed" class="text-2xl font-semibold tabular-nums">{{ summary.completed }}</p>
              <p class="text-[11px] text-muted-foreground">{{ t('projects.summary.completedTasks', { count: summary.completedTasks }) }}</p>
            </div>
          </div>
        </div>
      </div>
    </section>

    <div class="nasq-toolbar" data-testid="projects-toolbar">
      <FilterBar class="w-full">
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
        <div role="group" class="inline-flex h-[40px] items-center rounded-lg border bg-muted/40 p-0.5" :aria-label="t('projects.filters.view')">
          <Button data-testid="projects-view-table" type="button" variant="ghost" size="icon" class="size-[32px] rounded-md" :class="view === 'table' ? 'bg-background shadow-sm' : ''" :disabled="!hydrated" :aria-label="t('projects.filters.tableView')" :aria-pressed="view === 'table'" @click="onViewChange('table')">
            <List class="size-[18px]" />
          </Button>
          <Button data-testid="projects-view-cards" type="button" variant="ghost" size="icon" class="size-[32px] rounded-md" :class="view === 'cards' ? 'bg-background shadow-sm' : ''" :disabled="!hydrated" :aria-label="t('projects.filters.cardView')" :aria-pressed="view === 'cards'" @click="onViewChange('cards')">
            <LayoutGrid class="size-[18px]" />
          </Button>
        </div>
        <Button v-if="canCreate" data-testid="project-new" :disabled="!hydrated" class="gap-2" @click="openCreate">
          <Plus class="size-[18px]" />{{ t('projects.new') }}
        </Button>
        <Button as-child variant="outline">
          <NuxtLink :to="{ path: '/project-templates', query: returnToQuery(route.fullPath) }" data-testid="project-templates-link">
            {{ t('projects.planningLinks.templates') }}
          </NuxtLink>
        </Button>
      </template>

      <template #active>
        <div v-if="rawSearch || statusFilter !== 'all' || sort !== 'default'" class="flex flex-wrap items-center gap-2">
          <Badge v-if="rawSearch" variant="secondary">{{ t('projects.filters.searchValue', { value: rawSearch }) }}</Badge>
          <Badge v-if="statusFilter !== 'all'" variant="secondary">{{ t(statusFilter === 'unset' ? 'projects.filters.unset' : `projects.status.${statusFilter}`) }}</Badge>
          <Badge v-if="sort !== 'default'" variant="secondary">{{ t(sort === 'name' ? 'projects.filters.sortName' : 'projects.filters.sortProgress') }}</Badge>
          <Button variant="ghost" size="sm" class="gap-1" :disabled="!hydrated" @click="clearFilters">
            <X class="size-3.5" />{{ t('projects.filters.clear') }}
          </Button>
        </div>
      </template>
      </FilterBar>
    </div>

    <SharedPageState v-if="projectList.error.value" :error="projectList.error.value" @retry="projectList.refetch" />
    <template v-else>
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
