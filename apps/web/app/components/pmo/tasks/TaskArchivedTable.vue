<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import type { RowAction } from '@liwan/ui/app/components/shared/data/RowActions.vue'
import type { Task } from '@liwan/contracts'
import { ApiError } from '@/composables/useApi'
import { useArchivedTasks, useRestoreTask } from '@/composables/useArchivedTasks'

// The archived tasks of a scope (the caller's, or one project's) as a bare table with a restore action per row. The host
// draws the card and the search around it: the archived page on /tasks, and the «مؤرشفة» scope of a project's task list.
const props = defineProps<{
  params: { project_id?: number; mine: boolean; q?: string }
  /** The scope is one project: its name column would repeat the same value on every row. */
  hideProject?: boolean
}>()
const { t } = useI18n()
const toast = useToast()
const hydrated = useHydrated()

const paramsRef = computed(() => props.params)
const { data, isLoading, error, refetch, hasNextPage, fetchNextPage, isFetchingNextPage } = useArchivedTasks(paramsRef)
const items = computed(() => (data.value?.pages ?? []).flatMap((page) => page.items))
const total = computed(() => data.value?.pages[0]?.total ?? 0)
const { mutate: restore, isPending } = useRestoreTask()

function restoreTask(task: Task) {
  restore({ id: task.id }, {
    onSuccess: () => toast.add({ title: t('taskLifecycle.restored'), color: 'success' }),
    onError: (error) => toast.add({ title: error instanceof ApiError ? error.message : t('errors.generic'), color: 'error' }),
  })
}
const columns = computed<TableColumn<Task>[]>(() => [
  { id: 'name', header: t('tasks.columns.title') },
  ...(props.hideProject ? [] : [{ id: 'project', header: t('tasks.columns.project') }]),
  { id: 'actions', header: t('app.actions'), meta: { class: { th: 'w-0', td: 'w-0 text-end' } } },
])
const restoreActions = (task: Task): RowAction[] => [{ label: t('taskLifecycle.restore'), icon: 'i-lucide-archive-restore', onSelect: () => restoreTask(task) }]
</script>

<template>
  <SharedDataTable
    bare
    :rows="items"
    :columns="columns"
    row-key="id"
    :loading="isLoading && !items.length"
    :error="items.length ? null : error"
    :empty-text="t('taskLifecycle.noArchivedTasks')"
    :caption="t('taskLifecycle.archivedTasks')"
    @retry="refetch"
  >
    <template #footer>
      <span class="tabular-nums" data-testid="archived-tasks-count">{{ t('tasks.footer.results', { shown: items.length, total }, total) }}</span>
      <UButton v-if="hasNextPage" color="neutral" variant="outline" size="sm" :loading="isFetchingNextPage" :disabled="isFetchingNextPage || !hydrated" @click="fetchNextPage()">{{ t('taskLifecycle.loadMore') }}</UButton>
    </template>
    <template #name-cell="{ row }"><span class="font-medium text-highlighted">{{ row.original.name }}</span></template>
    <template #project-cell="{ row }">{{ row.original.project?.name ?? '—' }}</template>
    <template #actions-cell="{ row }">
      <SharedRowActions :label="row.original.name" :disabled="isPending" :actions="restoreActions(row.original)" />
    </template>
    <template #mobile-row="{ row: task }">
      <div class="flex items-center justify-between gap-3">
        <div class="min-w-0">
          <p class="truncate font-medium text-highlighted">{{ task.name }}</p>
          <p v-if="!hideProject" class="truncate text-sm text-muted">{{ task.project?.name ?? '—' }}</p>
        </div>
        <SharedRowActions :label="task.name" :disabled="isPending" :actions="restoreActions(task)" />
      </div>
    </template>
  </SharedDataTable>
</template>
