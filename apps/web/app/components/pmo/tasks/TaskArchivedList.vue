<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import type { RowAction } from '@nasq/ui/app/components/shared/data/RowActions.vue'
import type { Task } from '@nasq/contracts'
import { safeReturnTo } from '@/utils/safeReturnTo'
import { ApiError } from '@/composables/useApi'
import { useArchivedTasks, useRestoreTask } from '@/composables/useArchivedTasks'
import FilterBar from '@nasq/ui/app/components/shared/data/FilterBar.vue'

const route = useRoute()
const router = useRouter()
const { t } = useI18n()
const toast = useToast()
const hydrated = useHydrated()
const q = ref(typeof route.query.q === 'string' ? route.query.q : '')
const projectId = computed(() => {
  const value = Number(route.query.project_id)
  return Number.isInteger(value) && value > 0 ? value : undefined
})
watch(q, value => {
  if (value !== String(route.query.q ?? '')) void router.replace({ query: { ...route.query, q: value || undefined } })
})
watch(() => route.query.q, value => { q.value = typeof value === 'string' ? value : '' })
const mine = computed(() => route.query.filter === 'mine')
const params = computed(() => ({ project_id: projectId.value, mine: mine.value, q: q.value.trim() || undefined }))
const { data, isLoading, error, refetch, hasNextPage, fetchNextPage, isFetchingNextPage } = useArchivedTasks(params)
const items = computed(() => (data.value?.pages ?? []).flatMap((page) => page.items))
const total = computed(() => data.value?.pages[0]?.total ?? 0)
const { mutate: restore, isPending } = useRestoreTask()
const backTo = computed(() => safeReturnTo(route.query.returnTo, projectId.value ? `/projects/${projectId.value}/tasks` : '/tasks', ['/tasks', '/projects']))
const activeFilterCount = computed(() => Number(Boolean(q.value.trim())))

function clearFilters() {
  q.value = ''
}

function restoreTask(task: Task) {
  restore({ id: task.id }, {
    onSuccess: () => toast.add({ title: t('taskLifecycle.restored'), color: 'success' }),
    onError: (error) => toast.add({ title: error instanceof ApiError ? error.message : t('errors.generic'), color: 'error' }),
  })
}
const columns = computed<TableColumn<Task>[]>(() => [
  { id: 'name', header: t('tasks.columns.title') },
  { id: 'project', header: t('tasks.columns.project') },
  { id: 'actions', header: t('app.actions'), meta: { class: { th: 'w-0', td: 'w-0 text-end' } } },
])
const restoreActions = (task: Task): RowAction[] => [{ label: t('taskLifecycle.restore'), icon: 'i-lucide-archive-restore', onSelect: () => restoreTask(task) }]
</script>

<template>
  <SharedListPage
    :title="t('taskLifecycle.archivedTasks')"
    :description="t('taskLifecycle.archivedTasksHint')"
    :back-to="backTo"
    :back-label="t('taskLifecycle.back')"
  >
    <template #filters>
      <div class="w-full min-w-0" data-testid="archived-tasks-toolbar">
        <FilterBar class="w-full" :active-count="activeFilterCount" :disabled="!hydrated" @clear="clearFilters">
          <template #search>
            <UInput v-model="q" :disabled="!hydrated" :placeholder="t('taskLifecycle.searchArchived')" :aria-label="t('taskLifecycle.searchArchived')" icon="i-lucide-search" class="min-w-56 max-w-sm" />
          </template>
          <template #actions>
            <UBadge v-if="data" color="neutral" variant="subtle">{{ total }}</UBadge>
          </template>
          <template #active>
            <div v-if="q.trim()" class="flex flex-wrap items-center gap-2">
              <SharedFilterChip :label="t('tasks.filters.searchValue', { value: q.trim() })" @remove="clearFilters" />
            </div>
          </template>
        </FilterBar>
      </div>
    </template>
    <SharedDataTable
      :rows="items"
      :columns="columns"
      row-key="id"
      :loading="isLoading && !items.length"
      :error="items.length ? null : error"
      :empty-text="t('taskLifecycle.noArchivedTasks')"
      :caption="t('taskLifecycle.archivedTasks')"
      @retry="refetch"
    >
      <template #name-cell="{ row }"><span class="font-medium text-highlighted">{{ row.original.name }}</span></template>
      <template #project-cell="{ row }">{{ row.original.project?.name ?? '—' }}</template>
      <template #actions-cell="{ row }">
        <SharedRowActions :label="row.original.name" :disabled="isPending" :actions="restoreActions(row.original)" />
      </template>
      <template #mobile-row="{ row: task }">
        <div class="flex items-center justify-between gap-3">
          <div class="min-w-0">
            <p class="truncate font-medium text-highlighted">{{ task.name }}</p>
            <p class="truncate text-sm text-muted">{{ task.project?.name ?? '—' }}</p>
          </div>
          <SharedRowActions :label="task.name" :disabled="isPending" :actions="restoreActions(task)" />
        </div>
      </template>
    </SharedDataTable>
    <div v-if="hasNextPage" class="text-center">
      <UButton color="neutral" variant="outline" type="button" :loading="isFetchingNextPage" :disabled="isFetchingNextPage || !hydrated" @click="fetchNextPage()">{{ t('taskLifecycle.loadMore') }}</UButton>
    </div>
  </SharedListPage>
</template>
