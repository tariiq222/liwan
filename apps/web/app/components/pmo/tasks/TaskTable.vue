<script setup lang="ts">
import type { Task } from '@liwan/contracts'
import type { TableColumn } from '@nuxt/ui'
import type { RouteLocationRaw } from 'vue-router'
import { recordNumberHeader } from '@liwan/ui/app/utils/recordNumberHeader'
import { deadlineCellView } from './taskDeadline'
import { taskAttributeFilterCount } from '@/composables/taskFilterParams'
import type { TaskColumnId, TaskTableVariant } from '@/composables/taskColumns'
import { useTaskColumns } from '@/composables/useTaskColumns'
import { TASK_SORT_KEYS, taskSortFromParam, taskSortToParam } from '@/composables/taskSort'
import type { TableSort } from '@liwan/ui/app/utils/dataTable'
import { useTasks, type TaskListParams } from '@/composables/useTasks'
import RecordNumber from '@liwan/ui/app/components/shared/data/RecordNumber.vue'
import TaskDescriptionHint from './TaskDescriptionHint.vue'
import PrioritySelect from './PrioritySelect.vue'
import StateMenu from './StateMenu.vue'

// The task list on SharedDataTable. The title is a real link to `rowTo(task)` followed by a muted info icon (the
// description's first line in a tooltip); a click on the row background opens it too, and StateMenu / PrioritySelect
// keep their own clicks.
// It is bare: the page wraps it in a SharedListCard whose header row holds the filter bar. "Load more" is an infinite query, not paging, so it stays here (in the
// footer, beside the result count); the empty state keeps its create action.
const props = withDefaults(defineProps<{
  params: TaskListParams
  rowTo: (task: Task) => RouteLocationRaw
  variant?: TaskTableVariant
  /** False when the host cannot take new tasks (an archived project): the empty state then offers no create action. */
  canCreate?: boolean
}>(), { variant: 'mine', canCreate: true })
const emit = defineEmits<{ create: []; 'update:sort': [sort: string | undefined] }>()

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
  () => !!props.params.q || (props.variant === 'mine' && !!props.params.project_id) || !!props.params.state?.length || taskAttributeFilterCount(props.params) > 0,
)
const emptyTitleKey = computed(() => {
  if (hasActiveFilters.value) return 'app.noResults'
  if (props.params.closed) return 'tasks.empty.closedTitle'
  return props.variant === 'project' ? 'projects.tasksEmpty' : 'tasks.empty.title'
})
const showCreateAction = computed(() => props.canCreate && can('pmo.tasks.create') && !hasActiveFilters.value && !props.params.closed)

// One width scale for both variants. Narrow columns are fixed px, wide enough for the pill plus the tight cell padding (a pill or tag never clips, wraps or spills into the next column), Project takes 16%
// with a floor, and the title absorbs the rest. A width sits on the header and the cell alike. Text columns truncate with an
// ellipsis; a column holding a badge or a menu trigger (`fit`) never clips. Only the record number, priority and deadline
// sort (the server cannot order by state or by the text columns): their server keys are TASK_SORT_KEYS.
// SharedDataTable measures the fixed columns itself, so the table's minimum width follows the columns that are shown.
const WIDTH = {
  record_number: 'w-[48px] min-w-[48px] px-2',
  title: 'min-w-[280px]',
  project: 'w-[16%] min-w-[140px]',
  state: 'w-[136px] min-w-[136px] px-2',
  priority: 'w-[132px] min-w-[132px] px-2',
  deadline: 'w-[112px] min-w-[112px] px-2',
  assignees: 'w-[176px] min-w-[176px]',
  stage: 'w-[112px] min-w-[112px]',
}
function column(id: string, header: TableColumn<Task>['header'], width: string, fit = false): TableColumn<Task> {
  const cell = fit ? 'whitespace-nowrap' : 'max-w-0 overflow-hidden text-ellipsis whitespace-nowrap'
  const sortable = id in TASK_SORT_KEYS
  return { id, header, meta: { sortable, class: { th: `text-start ${width}`, td: `${cell} ${width}` } } as TableColumn<Task>['meta'] }
}
// Reading order (first column first): the record number as a muted `#` reference, task, project, stage, state, priority, deadline and
// assignee. The record number and the stage are off until the person adds them from the toolbar's «الأعمدة» menu; the title is always shown.
const columnsShown = useTaskColumns(props.variant).visible
const numberHeader = () => recordNumberHeader(t)
const COLUMN_BUILDERS: Record<TaskColumnId, () => TableColumn<Task>> = {
  record_number: () => column('record_number', numberHeader, WIDTH.record_number, true),
  project: () => column('project', t('tasks.columns.project'), WIDTH.project),
  stage: () => column('stage', t('tasks.columns.stage'), WIDTH.stage),
  state: () => column('state', t('tasks.columns.state'), WIDTH.state, true),
  priority: () => column('priority', t('tasks.columns.priority'), WIDTH.priority, true),
  deadline: () => column('deadline', t('tasks.columns.deadline'), WIDTH.deadline, true),
  assignees: () => column('assignees', t('tasks.columns.assignees'), WIDTH.assignees),
}
const titleColumn = () => column('title', t('tasks.columns.title'), WIDTH.title)
const columns = computed<TableColumn<Task>[]>(() => {
  const shown = columnsShown.value
  return [
    ...(shown.includes('record_number') ? [COLUMN_BUILDERS.record_number()] : []),
    titleColumn(),
    ...shown.filter(id => id !== 'record_number').map(id => COLUMN_BUILDERS[id]()),
  ]
})

const sort = computed(() => taskSortFromParam(props.params.sort))
const onSort = (value: TableSort | null) => emit('update:sort', taskSortToParam(value))

// A deadline is plain text; only an unfinished task that is overdue or due within three days takes a colour.
const DEADLINE_TONE_CLASS = { plain: 'text-default', soon: 'liwan-status-text-warning font-medium', overdue: 'text-(--status-danger-foreground) font-medium' } as const
const assigneeNames = (task: Task) => task.assignees.map(person => person.name).join('، ')

const stageName = (task: Task) => (props.variant === 'project' ? task.stage?.name : task.personal_stage?.name) ?? '—'
</script>

<template>
  <div class="@container min-w-0 [&_table]:w-full [&_table]:table-fixed">
    <SharedDataTable
      bare
      :rows="items"
      :columns="columns"
      row-key="id"
      :row-to="rowTo"
      :loading="isLoading"
      :error="error"
      :empty-text="t(emptyTitleKey)"
      :caption="props.variant === 'project' ? t('projects.tabs.tasks') : t('tasks.title')"
      :sort="sort"
      :sort-keys="TASK_SORT_KEYS"
      @update:sort="onSort"
      @retry="refetch"
    >
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
      <template #project-cell="{ row }"><span :title="row.original.project?.name">{{ row.original.project?.name ?? '—' }}</span></template>
      <template #assignees-cell="{ row }">
        <span v-if="row.original.assignees.length" class="flex min-w-0 items-center gap-2" :title="assigneeNames(row.original)" data-testid="task-assignee">
          <SharedPersonAvatar :people="row.original.assignees.slice(0, 1)" />
          <span class="min-w-0 truncate">{{ row.original.assignees[0]!.name }}</span>
          <span v-if="row.original.assignees.length > 1" class="shrink-0 text-xs tabular-nums text-muted">+{{ row.original.assignees.length - 1 }}</span>
        </span>
        <span v-else class="text-muted">—</span>
      </template>
      <template #stage-cell="{ row }"><span :title="stageName(row.original)">{{ stageName(row.original) }}</span></template>
      <template #state-cell="{ row }"><StateMenu :task="row.original" /></template>
      <template #deadline-cell="{ row }">
        <span v-if="hydrated && deadlineCellView(row.original)" data-testid="deadline-badge" class="tabular-nums" :class="DEADLINE_TONE_CLASS[deadlineCellView(row.original)!.tone ?? 'plain']" :data-tone="deadlineCellView(row.original)!.tone ?? undefined">{{ deadlineCellView(row.original)!.text }}</span>
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
            <span v-if="hydrated && deadlineCellView(task)" class="shrink-0 text-sm tabular-nums" :class="DEADLINE_TONE_CLASS[deadlineCellView(task)!.tone ?? 'plain']" :data-tone="deadlineCellView(task)!.tone ?? undefined" data-testid="deadline-badge">{{ deadlineCellView(task)!.text }}</span>
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
