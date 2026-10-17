<script setup lang="ts">
import type { Task } from '@webvue/contracts'
import type { TableColumn } from '@nuxt/ui'
import type { RouteLocationRaw } from 'vue-router'
import { deadlineLabel, deadlineTag } from '@/composables/taskState'
import { recordNumberHeader } from '@webvue/ui/app/utils/recordNumberHeader'
import { formatDate } from '@webvue/ui/app/utils/formatDate'
import { taskDaysRemaining } from './taskDeadline'
import { useTasks, type TaskListParams } from '@/composables/useTasks'
import RecordNumber from '@webvue/ui/app/components/shared/data/RecordNumber.vue'
import TaskDescriptionHint from './TaskDescriptionHint.vue'
import PrioritySelect from './PrioritySelect.vue'
import StateMenu from './StateMenu.vue'

// The task list on SharedDataTable. The title is a real link to `rowTo(task)` followed by a muted info icon (the
// description's first line in a tooltip); a click on the row background opens it too, and StateMenu / PrioritySelect
// keep their own clicks.
// The `filters` slot is the card's header row. "Load more" is an infinite query, not paging, so it stays here (in the
// footer, beside the result count); the empty state keeps its create action.
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
const total = computed(() => data.value?.pages.at(-1)?.total ?? items.value.length)

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
function column(id: string, header: TableColumn<Task>['header'], width: string, fit = false): TableColumn<Task> {
  const cell = fit ? 'whitespace-nowrap' : 'max-w-0 overflow-hidden text-ellipsis whitespace-nowrap'
  return { id, header, meta: { class: { th: `text-start ${width}`, td: `${cell} ${width}` } } }
}
// Reading order (first column first): the record number as a muted `#` reference, task, project (the stage in a project's own list), state, priority, deadline,
// assignee, the secondary stage (hidden on narrow containers) and the record number last as a muted reference.
const numberHeader = () => recordNumberHeader(t)
const columns = computed<TableColumn<Task>[]>(() => props.variant === 'project'
  ? [
      column('record_number', numberHeader, 'w-12 px-2', true), column('title', t('tasks.columns.title'), 'w-[38%]'), column('stage', t('tasks.columns.stage'), 'w-[12%]'),
      column('state', t('tasks.columns.state'), 'w-[14%] min-w-32', true), column('priority', t('tasks.columns.priority'), 'w-[12%] min-w-28', true),
      column('deadline', t('tasks.columns.deadline'), 'w-[12%] min-w-32', true), column('assignees', t('tasks.columns.assignees'), 'w-24 min-w-24', true),
    ]
  : [
      column('record_number', numberHeader, 'w-12 px-2', true), column('title', t('tasks.columns.title'), 'w-[32%]'), column('project', t('tasks.columns.project'), 'w-[12%]'),
      column('state', t('tasks.columns.state'), 'w-[12%] min-w-32', true), column('priority', t('tasks.columns.priority'), 'w-[10%] min-w-28', true),
      column('deadline', t('tasks.columns.deadline'), 'w-[11%] min-w-32', true), column('assignees', t('tasks.columns.assignees'), 'w-24 min-w-24', true),
      column('stage', t('tasks.columns.stage'), 'hidden w-[8%] @3xl:table-cell'),
    ])

const stageName = (task: Task) => (props.variant === 'project' ? task.stage?.name : task.personal_stage?.name) ?? '—'
// The deadline tag reads the days: overdue "exceeded N days", today, a future date "N days left"; a closed task shows its
// plain date. The full formatted date is the tag's tooltip and accessible name.
function deadlineText(task: Task): string {
  const days = taskDaysRemaining(task)
  return task.is_closed && task.date_deadline ? formatDate(task.date_deadline) : deadlineLabel(days, t)
}
function deadlineTitle(task: Task): string | undefined {
  return task.date_deadline ? formatDate(task.date_deadline) : undefined
}
</script>

<template>
  <div class="@container min-w-0 [&_table]:w-full [&_table]:min-w-[max(100%,960px)]">
    <SharedDataTable
      embedded-filters
      :rows="items"
      :columns="columns"
      row-key="id"
      :row-to="rowTo"
      :loading="isLoading"
      :error="error"
      :empty-text="t(emptyTitleKey)"
      :caption="props.variant === 'project' ? t('projects.tabs.tasks') : t('tasks.title')"
      @retry="refetch"
    >
      <template v-if="$slots.filters" #filters><slot name="filters" /></template>
      <template v-if="showCreateAction" #emptyAction>
        <UButton size="sm" :disabled="!hydrated" @click="emit('create')">{{ t('tasks.empty.action') }}</UButton>
      </template>
      <template #footer>
        <span class="tabular-nums" data-testid="tasks-result-count">{{ t('tasks.footer.results', { shown: items.length, total }, total) }}</span>
        <UButton v-if="hasNextPage" color="neutral" variant="outline" size="sm" :loading="isFetchingNextPage" :disabled="isFetchingNextPage || !hydrated" @click="fetchNextPage()">
          {{ t('app.loadMore') }}
        </UButton>
      </template>
      <template #record_number-cell="{ row }"><RecordNumber :value="row.original.id" /></template>
      <template #title-cell="{ row }">
        <div class="flex min-w-0 items-center gap-1">
          <NuxtLink
            :to="rowTo(row.original)"
            class="block min-w-0 truncate text-base font-semibold text-highlighted hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >{{ row.original.name }}</NuxtLink>
          <TaskDescriptionHint :excerpt="row.original.description_excerpt" />
        </div>
      </template>
      <template #project-cell="{ row }">{{ row.original.project?.name ?? '—' }}</template>
      <template #assignees-cell="{ row }"><SharedPersonAvatar :people="row.original.assignees" /></template>
      <template #stage-cell="{ row }">{{ stageName(row.original) }}</template>
      <template #state-cell="{ row }"><StateMenu :task="row.original" /></template>
      <template #deadline-cell="{ row }">
        <SharedStatusBadge v-if="deadlineTag(taskDaysRemaining(row.original), row.original.is_closed)" v-bind="deadlineTag(taskDaysRemaining(row.original), row.original.is_closed)!" data-testid="deadline-badge" size="sm" :label="deadlineText(row.original)" :title="deadlineTitle(row.original)" :aria-label="`${deadlineText(row.original)} ${deadlineTitle(row.original) ?? ''}`.trim()" />
        <span v-else data-testid="deadline-badge" class="text-muted">—</span>
      </template>
      <template #priority-cell="{ row }"><PrioritySelect :task="row.original" variant="badge" /></template>
      <template #mobile-row="{ row: task }">
        <div class="space-y-3">
          <div class="flex items-start justify-between gap-3">
            <div class="min-w-0 flex-1">
              <RecordNumber :value="task.id" />
              <div class="flex min-w-0 items-center gap-1">
                <NuxtLink :to="rowTo(task)" class="block min-w-0 truncate font-medium text-highlighted hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">{{ task.name }}</NuxtLink>
                <TaskDescriptionHint :excerpt="task.description_excerpt" />
              </div>
            </div>
            <SharedStatusBadge v-if="deadlineTag(taskDaysRemaining(task), task.is_closed)" v-bind="deadlineTag(taskDaysRemaining(task), task.is_closed)!" class="shrink-0" data-testid="deadline-badge" size="sm" :label="deadlineText(task)" :title="deadlineTitle(task)" :aria-label="`${deadlineText(task)} ${deadlineTitle(task) ?? ''}`.trim()" />
            <span v-else class="shrink-0 text-muted" data-testid="deadline-badge">—</span>
          </div>
          <p class="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted">
            <span class="truncate">{{ task.project?.name ?? (props.variant === 'project' ? task.stage?.name : '—') }}</span>
            <span v-if="props.variant === 'project' && task.stage && task.project" aria-hidden="true">·</span>
            <span v-if="props.variant === 'project' && task.stage && task.project" class="truncate">{{ task.stage.name }}</span>
            <span v-else-if="props.variant !== 'project' && task.personal_stage" aria-hidden="true">·</span>
            <span v-if="props.variant !== 'project' && task.personal_stage" class="truncate">{{ task.personal_stage.name }}</span>
          </p>
          <div class="flex flex-wrap items-center gap-2">
            <StateMenu :task="task" />
            <PrioritySelect :task="task" variant="badge" />
            <SharedPersonAvatar v-if="task.assignees.length" class="ms-auto" :people="task.assignees" />
          </div>
        </div>
      </template>
    </SharedDataTable>
  </div>
</template>
