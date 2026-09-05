<script setup lang="ts">
import { PROJECT_STATUSES, type ProjectStatus } from '@nasq/contracts'
import { Search, X } from 'lucide-vue-next'
import { refDebounced } from '@vueuse/core'
import FilterBar from '@/components/shared/FilterBar.vue'
import PageHeader from '@/components/shared/PageHeader.vue'
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

const rawSearch = computed(() => typeof route.query.q === 'string' ? route.query.q : '')
const search = ref(rawSearch.value)
const debouncedSearch = refDebounced(search, 250)
watch(rawSearch, (value) => {
  if (value !== search.value) search.value = value
})
watch(debouncedSearch, (value) => {
  const q = value.trim()
  if (q === rawSearch.value) return
  router.replace({ query: { ...route.query, q: q || undefined } })
})

const statusFilter = computed<'all' | 'unset' | ProjectStatus>(() => {
  const value = route.query.status
  if (value === 'unset') return 'unset'
  if (typeof value === 'string' && PROJECT_STATUSES.includes(value as ProjectStatus)) return value as ProjectStatus
  return 'all'
})
function onStatusChange(value: unknown) {
  const status = typeof value === 'string' ? value : 'all'
  router.replace({ query: { ...route.query, status: status === 'all' ? undefined : status } })
}
function clearFilters() {
  search.value = ''
  router.replace({ query: { ...route.query, q: undefined, status: undefined } })
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
const isLoading = computed(() => projectList.isLoading.value)

function onFilterChange(v: unknown) {
  router.replace({ query: { ...route.query, archived: v === 'archived' ? '1' : undefined } })
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
