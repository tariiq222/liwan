<script setup lang="ts">
import { PROJECT_STATUSES } from '@nasq/contracts'
import { Search, X } from 'lucide-vue-next'
import { refDebounced } from '@vueuse/core'
import FilterBar from '@/components/shared/FilterBar.vue'
import PageHeader from '@/components/shared/PageHeader.vue'
import ProjectTable from '@/components/project/ProjectTable.vue'
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
    status: filters.status,
    offset: filters.offset,
    archived: canListArchived.value && filters.archived,
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
  limit: PROJECT_PAGE,
  offset: filters.offset,
}))
const projectList = useProjectList(archived, listFilters)
const items = computed(() => projectList.data.value?.items ?? [])
const canCreate = computed(() => projectList.data.value?.can_create ?? false)
const total = computed(() => projectList.data.value?.total ?? 0)
const page = computed(() => Math.floor(listOffset.value / PROJECT_PAGE) + 1)
const pages = computed(() => Math.max(1, Math.ceil(total.value / PROJECT_PAGE)))

watch(debouncedSearch, (value) => {
  if (value.trim() === filters.q.trim()) return
  applyPatch({ q: value })
})
watch(
  [() => filters.q, () => filters.status, () => filters.offset, () => canListArchived.value && filters.archived],
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
  Object.assign(filters, parsed)
  queueMicrotask(() => { applyingRoute = false })
})

function onStatusChange(value: unknown) {
  applyPatch({ status: parseProjectListStatus(value) })
}
function clearFilters() {
  search.value = ''
  applyPatch({ q: '', status: 'all' })
}
const isLoading = computed(() => projectList.isLoading.value)

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
  <div class="space-y-4">
    <PageHeader :title="t('projects.title')">
      <template #actions>
        <Button v-if="canCreate" data-testid="project-new" :disabled="!hydrated" @click="openCreate">
          {{ t('projects.new') }}
        </Button>
      </template>
    </PageHeader>

    <FilterBar>
      <template #search>
        <div class="relative min-w-52 flex-1">
          <Search class="pointer-events-none absolute start-2 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
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
          <SelectTrigger class="w-40" :disabled="!hydrated">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{{ t('projects.filters.allStatuses') }}</SelectItem>
            <SelectItem value="unset">{{ t('projects.filters.unset') }}</SelectItem>
            <SelectItem v-for="status in PROJECT_STATUSES" :key="status" :value="status">{{ t(`projects.status.${status}`) }}</SelectItem>
          </SelectContent>
        </Select>
      </template>

      <template #active>
        <div v-if="rawSearch || statusFilter !== 'all'" class="flex flex-wrap items-center gap-2">
          <Badge v-if="rawSearch" variant="secondary">{{ t('projects.filters.searchValue', { value: rawSearch }) }}</Badge>
          <Badge v-if="statusFilter !== 'all'" variant="secondary">{{ t(statusFilter === 'unset' ? 'projects.filters.unset' : `projects.status.${statusFilter}`) }}</Badge>
          <Button variant="ghost" size="sm" class="gap-1" :disabled="!hydrated" @click="clearFilters">
            <X class="size-3.5" />{{ t('projects.filters.clear') }}
          </Button>
        </div>
      </template>
    </FilterBar>

    <SharedPageState v-if="projectList.error.value" :error="projectList.error.value" @retry="projectList.refetch" />
    <template v-else>
      <ProjectTable
        :items="items"
        :capped="false"
        :filtered="Boolean(rawSearch.trim()) || statusFilter !== 'all'"
        :is-loading="isLoading"
        :archived="archived"
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
  </div>
</template>
