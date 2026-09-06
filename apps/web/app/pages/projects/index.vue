<script setup lang="ts">
import { PROJECT_STATUSES, type ProjectStatus } from '@nasq/contracts'
import type { LocationQueryRaw } from 'vue-router'
import { CircleAlert, CircleCheck, Eye, EyeOff, FolderKanban, Search, X } from '@lucide/vue'
import { refDebounced } from '@vueuse/core'
import FilterBar from '@/components/shared/FilterBar.vue'
import ProjectTable from '@/components/project/ProjectTable.vue'
import { useProjectList } from '@/composables/useProjects'
import { returnToQuery } from '@/utils/safeReturnTo'

const router = useRouter()
const route = useRoute()
const { t } = useI18n()
const hydrated = useHydrated()

// Always fetch the active list — same query key as ProjectTable's own
// useProjectList(archived) call whenever archived is false, so this doesn't
// cause a second network request in the common case, and it's the only
// source of truth for can_list_archived (the server only sets that flag on
// the full, non-minimal response).
const activeList = useProjectList(ref(false))
const canListArchived = computed(() => activeList.data.value?.can_list_archived ?? false)

// Never resolve to true unless the server says this user may list archived
// projects — a manager-gated 403 must never reach useProjectList, or an
// employee following a stale/shared `?archived=1` link sees a silent empty
// table instead of the active list.
const archived = computed(() => canListArchived.value && route.query.archived === '1')
const projectList = useProjectList(archived)
const items = computed(() => projectList.data.value?.items ?? [])
const canCreate = computed(() => projectList.data.value?.can_create ?? false)
const summaryVisible = ref(true)
const summaryStorageKey = 'nasq.projects.summary-visible'

// Search can debounce while a select navigation is still pending. Merge into
// the latest requested query so neither control overwrites the other's value.
let pendingQuery: LocationQueryRaw | null = null
function replaceFilters(patch: LocationQueryRaw) {
  const next = { ...(pendingQuery ?? router.currentRoute.value.query), ...patch }
  pendingQuery = next
  void router.replace({ query: next }).finally(() => {
    if (pendingQuery === next) pendingQuery = null
  })
}

const rawSearch = computed(() => typeof route.query.q === 'string' ? route.query.q : '')
const search = ref(rawSearch.value)
const debouncedSearch = refDebounced(search, 250)
watch(rawSearch, (value) => {
  if (value !== search.value) search.value = value
})
watch(debouncedSearch, (value) => {
  const q = value.trim()
  if (q === rawSearch.value) return
  replaceFilters({ q: q || undefined })
})

const statusFilter = computed<'all' | 'unset' | ProjectStatus>(() => {
  const value = route.query.status
  if (value === 'unset') return 'unset'
  if (typeof value === 'string' && PROJECT_STATUSES.includes(value as ProjectStatus)) return value as ProjectStatus
  return 'all'
})
function onStatusChange(value: unknown) {
  const status = typeof value === 'string' ? value : 'all'
  replaceFilters({ status: status === 'all' ? undefined : status })
}
function clearFilters() {
  search.value = ''
  replaceFilters({ q: undefined, status: undefined })
}
const filteredItems = computed(() => {
  const query = rawSearch.value.trim().toLocaleLowerCase()
  return items.value.filter((project) => {
    const matchesSearch = !query || project.name.toLocaleLowerCase().includes(query)
    const matchesStatus = statusFilter.value === 'all'
      || (statusFilter.value === 'unset' ? project.status === null : project.status === statusFilter.value)
    return matchesSearch && matchesStatus
  })
})
const summary = computed(() => ({
  displayed: filteredItems.value.length,
  attention: filteredItems.value.filter(project => project.status === 'at_risk' || project.status === 'off_track' || project.status === 'on_hold').length,
  completed: filteredItems.value.filter(project => project.status === 'done').length,
}))
const isLoading = computed(() => projectList.isLoading.value)

onMounted(() => {
  const saved = window.localStorage.getItem(summaryStorageKey)
  if (saved === 'hidden' || saved === 'visible') summaryVisible.value = saved === 'visible'
})
watch(summaryVisible, (visible) => {
  if (import.meta.client) window.localStorage.setItem(summaryStorageKey, visible ? 'visible' : 'hidden')
})

function onFilterChange(v: unknown) {
  replaceFilters({ archived: v === 'archived' ? '1' : undefined })
}

function openCreate() {
  router.push({ path: '/projects/new', query: returnToQuery(route.fullPath) })
}
function openProject(id: number) {
  router.push({ path: `/projects/${id}`, query: returnToQuery(route.fullPath) })
}
</script>

<template>
  <div class="space-y-6">
    <SharedPageHeader :title="t('projects.title')" :description="t('projects.description')">
      <template #actions>
        <Button v-if="canCreate" data-testid="project-new" :disabled="!hydrated" class="gap-2" @click="openCreate">
          {{ t('projects.new') }}
        </Button>
      </template>
    </SharedPageHeader>

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
            <p data-testid="projects-summary-displayed" class="mt-1 text-2xl font-semibold tabular-nums">{{ summary.displayed }}</p>
          </div>
        </div>
        <div class="flex items-center gap-3 rounded-lg border bg-card p-4">
          <span class="grid size-[32px] shrink-0 place-items-center rounded-lg border bg-muted text-muted-foreground"><CircleAlert class="size-[18px]" /></span>
          <div class="min-w-0">
            <p class="text-xs text-muted-foreground">{{ t('projects.summary.attention') }}</p>
            <p data-testid="projects-summary-attention" class="mt-1 text-2xl font-semibold tabular-nums">{{ summary.attention }}</p>
          </div>
        </div>
        <div class="flex items-center gap-3 rounded-lg border bg-card p-4">
          <span class="grid size-[32px] shrink-0 place-items-center rounded-lg border bg-muted text-muted-foreground"><CircleCheck class="size-[18px]" /></span>
          <div class="min-w-0">
            <p class="text-xs text-muted-foreground">{{ t('projects.summary.completed') }}</p>
            <p data-testid="projects-summary-completed" class="mt-1 text-2xl font-semibold tabular-nums">{{ summary.completed }}</p>
          </div>
        </div>
      </div>
    </section>

    <div class="rounded-lg border bg-card p-3">
      <FilterBar>
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
    </div>

    <ProjectTable
      :items="filteredItems"
      :capped="items.length >= 200"
      :filtered="Boolean(rawSearch.trim()) || statusFilter !== 'all'"
      :is-loading="isLoading"
      :archived="archived"
      @open="openProject"
    />
  </div>
</template>
