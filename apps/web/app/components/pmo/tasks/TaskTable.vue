<script setup lang="ts">
import type { Task } from '@nasq/contracts'
import type { TableColumn } from '@nuxt/ui'
import type { RouteLocationRaw } from 'vue-router'
import { deadlineLabel, deadlineTone } from '@/composables/taskState'
import { taskDaysRemaining } from './taskDeadline'
import { useTasks, type TaskListParams } from '@/composables/useTasks'
import EmptyState from '@/components/shared/feedback/EmptyState.vue'
import RecordNumber from '@/components/shared/data/RecordNumber.vue'
import PrioritySelect from './PrioritySelect.vue'
import StateMenu from './StateMenu.vue'

// The task list on SharedDataTable. The title is a real link to `rowTo(task)`, a click on the row
// background opens it too, and StateMenu / PrioritySelect keep their own clicks. "Load more" is an
// infinite query, not paging, so it stays here; the empty state keeps its create action.
const props = withDefaults(defineProps<{
  params: TaskListParams
  rowTo: (task: Task) => RouteLocationRaw
  variant?: 'mine' | 'project'
}>(), { variant: 'mine' })
const emit = defineEmits<{ create: [] }>()

const { t } = useI18n()
const { can } = useAccess()
const hydrated = useHydrated()

const paramsRef = computed(() => props.params)
const { data, isLoading, hasNextPage, fetchNextPage, isFetchingNextPage, error, refetch } = useTasks(paramsRef)
const items = computed<Task[]>(() => data.value?.pages.flatMap(page => page.items) ?? [])

// A search/state/project filter yielding zero rows is a different situation from genuinely having no
// tasks: the empty state's create action only makes sense when nothing is filtered out. `closed` is a
// tab, not a filter in that sense, but an empty closed tab still isn't "no tasks assigned to you".
const hasActiveFilters = computed(
  () => !!props.params.q || (props.variant === 'mine' && !!props.params.project_id) || !!props.params.state?.length,
)
const emptyTitleKey = computed(() => {
  if (hasActiveFilters.value) return 'app.noResults'
  return props.params.closed ? 'tasks.empty.closedTitle' : 'tasks.empty.title'
})
const showCreateAction = computed(() => can('pmo.tasks.create') && !hasActiveFilters.value && !props.params.closed)

// Widths are applied to both the header and the cell; the number and title columns stay stable.
// Text columns truncate with an ellipsis; a column holding a badge or a menu trigger (`fit`) never
// clips, so a long deadline or state label is shown whole.
function column(id: string, header: string, width: string, fit = false): TableColumn<Task> {
  const cell = fit ? 'whitespace-nowrap' : 'max-w-0 overflow-hidden text-ellipsis whitespace-nowrap'
  return { id, header, meta: { class: { th: `text-start ${width}`, td: `${cell} ${width}` } } }
}
const columns = computed<TableColumn<Task>[]>(() => props.variant === 'project'
  ? [
      column('record_number', t('app.recordNumber'), 'w-[6%]'), column('title', t('tasks.columns.title'), 'w-[30%]'),
      column('assignees', t('tasks.columns.assignees'), 'w-[12%]'), column('stage', t('tasks.columns.stage'), 'w-[12%]'),
      column('deadline', t('tasks.columns.deadline'), 'w-[12%] min-w-36', true), column('priority', t('tasks.columns.priority'), 'w-[14%] min-w-28', true),
      column('state', t('tasks.columns.state'), 'w-[14%] min-w-32', true),
    ]
  : [
      column('record_number', t('app.recordNumber'), 'w-[7%]'), column('title', t('tasks.columns.title'), 'w-[30%]'),
      column('project', t('tasks.columns.project'), 'w-[14%]'), column('state', t('tasks.columns.state'), 'w-[14%] min-w-32', true),
      column('deadline', t('tasks.columns.deadline'), 'w-[13%] min-w-36', true), column('priority', t('tasks.columns.priority'), 'w-[12%] min-w-28', true),
      column('stage', t('tasks.columns.stage'), 'w-[10%]'),
    ])

const stageName = (task: Task) => (props.variant === 'project' ? task.stage?.name : task.personal_stage?.name) ?? '—'
// Same short-initials rule as TaskCard/Timeline: first letter of up to two words.
function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  return parts.length ? parts.slice(0, 2).map(part => part[0]!.toUpperCase()).join('') : '?'
}
</script>

<template>
  <div class="min-w-0 space-y-2 [&_table]:w-full" :class="props.variant === 'project' ? '[&_table]:min-w-[max(100%,960px)]' : '[&_table]:min-w-[max(100%,760px)]'">
    <SharedPageState v-if="error" :error="error" @retry="refetch" />
    <EmptyState v-else-if="!isLoading && items.length === 0" :title="t(emptyTitleKey)">
      <template v-if="showCreateAction" #action>
        <UButton size="sm" :disabled="!hydrated" @click="emit('create')">{{ t('tasks.empty.action') }}</UButton>
      </template>
    </EmptyState>
    <SharedDataTable
      v-else
      :rows="items"
      :columns="columns"
      row-key="id"
      :row-to="rowTo"
      :loading="isLoading"
      :caption="props.variant === 'project' ? t('projects.tabs.tasks') : t('tasks.title')"
    >
      <template #record_number-cell="{ row }"><RecordNumber :value="row.original.id" /></template>
      <template #title-cell="{ row }">
        <NuxtLink
          :to="rowTo(row.original)"
          class="block max-w-full truncate font-medium text-highlighted hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >{{ row.original.name }}</NuxtLink>
      </template>
      <template #project-cell="{ row }">{{ row.original.project?.name ?? '—' }}</template>
      <template #assignees-cell="{ row }">
        <span v-if="!row.original.assignees.length" class="text-muted">—</span>
        <span v-else class="inline-flex min-w-0 max-w-full items-center gap-2">
          <UAvatar :text="initials(row.original.assignees[0]!.name)" size="xs" class="shrink-0 bg-brand-soft text-brand-link" />
          <span class="truncate">{{ row.original.assignees.map(person => person.name).join('، ') }}</span>
        </span>
      </template>
      <template #stage-cell="{ row }">{{ stageName(row.original) }}</template>
      <template #state-cell="{ row }"><StateMenu :task="row.original" /></template>
      <template #deadline-cell="{ row }">
        <SharedStatusBadge data-testid="deadline-badge" :tone="deadlineTone(taskDaysRemaining(row.original), row.original.is_closed)" :label="deadlineLabel(taskDaysRemaining(row.original), t)" />
      </template>
      <template #priority-cell="{ row }"><PrioritySelect :task="row.original" /></template>
      <template #mobile-row="{ row: task }">
        <div class="space-y-3">
          <div class="flex items-start justify-between gap-3">
            <div class="min-w-0 flex-1">
              <RecordNumber :value="task.id" />
              <NuxtLink :to="rowTo(task)" class="block min-w-0 max-w-full truncate font-medium text-highlighted hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">{{ task.name }}</NuxtLink>
            </div>
            <SharedStatusBadge class="shrink-0" data-testid="deadline-badge" :tone="deadlineTone(taskDaysRemaining(task), task.is_closed)" :label="deadlineLabel(taskDaysRemaining(task), t)" />
          </div>
          <p class="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted">
            <span class="truncate">{{ task.project?.name ?? (props.variant === 'project' ? task.stage?.name : '—') }}</span>
            <span v-if="props.variant === 'project' && task.stage && task.project" aria-hidden="true">·</span>
            <span v-if="props.variant === 'project' && task.stage && task.project" class="truncate">{{ task.stage.name }}</span>
            <span v-else-if="props.variant !== 'project' && task.personal_stage" aria-hidden="true">·</span>
            <span v-if="props.variant !== 'project' && task.personal_stage" class="truncate">{{ task.personal_stage.name }}</span>
            <span v-if="task.assignees.length" aria-hidden="true">·</span>
            <span v-if="task.assignees.length" class="truncate">{{ task.assignees.map(person => person.name).join('، ') }}</span>
          </p>
          <div class="flex flex-wrap items-center gap-2">
            <StateMenu :task="task" />
            <PrioritySelect :task="task" />
          </div>
        </div>
      </template>
    </SharedDataTable>
    <div v-if="hasNextPage" class="flex justify-center">
      <UButton color="neutral" variant="outline" size="sm" :loading="isFetchingNextPage" :disabled="isFetchingNextPage || !hydrated" @click="fetchNextPage()">
        {{ t('app.loadMore') }}
      </UButton>
    </div>
  </div>
</template>
