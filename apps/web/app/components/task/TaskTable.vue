<script setup lang="ts">
import type { Task } from '@nasq/contracts'
import { FlexRender, createColumnHelper, getCoreRowModel, useVueTable } from '@tanstack/vue-table'
import { h } from 'vue'
import type { TaskListParams } from '@/composables/useTasks'
import { useTasks } from '@/composables/useTasks'
import DeadlineBadge from './DeadlineBadge.vue'
import PrioritySelect from './PrioritySelect.vue'
import StateMenu from './StateMenu.vue'
import EmptyState from '@/components/shared/EmptyState.vue'

const props = withDefaults(defineProps<{ params: TaskListParams; variant?: 'mine' | 'project'; embedded?: boolean }>(), { variant: 'mine', embedded: false })
const emit = defineEmits<{
  open: [id: number]
  create: []
}>()

const { t } = useI18n()
const { can } = useAccess()
// Rows (and the row-open click handler, "load more", and the empty state's
// "create" action) can be SSR-rendered with data already available, making
// them clickable before Nuxt hydrates and attaches listeners — the same
// race documented in README's "SSR hydration and interactive controls".
// The per-cell StateMenu/PrioritySelect controls gate themselves.
const hydrated = useHydrated()

const paramsRef = computed(() => props.params)
const { data, isLoading, hasNextPage, fetchNextPage, isFetchingNextPage, error, refetch } = useTasks(paramsRef)

const items = computed<Task[]>(() => data.value?.pages.flatMap((page) => page.items) ?? [])
// A search/state/project filter yielding zero rows is a different situation
// from genuinely having no tasks — the empty state (with a "create" action)
// only makes sense when nothing is filtered out. `closed` is a tab, not a
// filter in that sense, but an empty closed tab still isn't "no tasks
// assigned to you" (that copy — and its create action — belongs to the open
// tab only) so it gets its own message and no create action.
const hasActiveFilters = computed(
  () => !!props.params.q || (props.variant === 'mine' && !!props.params.project_id) || !!props.params.state?.length,
)
const emptyTitleKey = computed(() => {
  if (hasActiveFilters.value) return 'app.noResults'
  return props.params.closed ? 'tasks.empty.closedTitle' : 'tasks.empty.title'
})
const showCreateAction = computed(() => can('pmo.tasks.create') && !hasActiveFilters.value && !props.params.closed)

const columnHelper = createColumnHelper<Task>()
const titleColumn = columnHelper.accessor('name', {
  id: 'title',
  header: () => t('tasks.columns.title'),
  cell: (info) => h('button', {
    type: 'button',
    class: 'block max-w-full truncate rounded-sm text-start font-medium hover:underline',
    disabled: !hydrated.value,
    onClick: (event: MouseEvent) => { event.stopPropagation(); if (hydrated.value) emit('open', info.row.original.id) },
  }, info.row.original.name),
})
const projectColumn = columnHelper.display({
  id: 'project',
  header: () => t('tasks.columns.project'),
  cell: (info) => info.row.original.project?.name ?? '—',
})
const stateColumn = columnHelper.display({
  id: 'state',
  header: () => t('tasks.columns.state'),
  cell: (info) => h(StateMenu, { task: info.row.original }),
})
const deadlineColumn = columnHelper.display({
  id: 'deadline',
  header: () => t('tasks.columns.deadline'),
  cell: (info) =>
    h(DeadlineBadge, {
      deadline: info.row.original.date_deadline,
      daysRemaining: info.row.original.days_remaining,
      isClosed: info.row.original.is_closed,
    }),
})
const priorityColumn = columnHelper.display({
  id: 'priority',
  header: () => t('tasks.columns.priority'),
  cell: (info) => h(PrioritySelect, { task: info.row.original }),
})
const personalStageColumn = columnHelper.display({
  id: 'stage',
  header: () => t('tasks.columns.stage'),
  cell: (info) => info.row.original.personal_stage?.name ?? '—',
})
const projectStageColumn = columnHelper.display({
  id: 'stage',
  header: () => t('tasks.columns.stage'),
  cell: (info) => info.row.original.stage?.name ?? '—',
})
const assigneesColumn = columnHelper.display({
  id: 'assignees',
  header: () => t('tasks.columns.assignees'),
  cell: (info) => h('span', { class: 'truncate text-xs text-muted-foreground' }, info.row.original.assignees.map((a) => a.name).join('، ')),
})

const columns = computed(() =>
  props.variant === 'project'
    ? [titleColumn, assigneesColumn, projectStageColumn, deadlineColumn, priorityColumn, stateColumn]
    : [titleColumn, projectColumn, stateColumn, deadlineColumn, priorityColumn, personalStageColumn],
)

const colgroupClasses = computed(() =>
  props.variant === 'project'
    ? ['w-[42%]', 'w-[14%]', 'w-[12%]', 'w-[12%]', 'w-[8%]', 'w-[12%]']
    : ['w-[52%]', 'w-[12%]', 'w-[10%]', 'w-[10%]', 'w-[10%]', 'w-[6%]'],
)

const table = useVueTable({
  get data() {
    return items.value
  },
  get columns() {
    return columns.value
  },
  getCoreRowModel: getCoreRowModel(),
})

// The state/priority cells are interactive controls of their own (dropdown
// trigger, select trigger); a click that lands on one of them must not also
// open the row.
function onRowClick(task: Task, event: MouseEvent) {
  if (!hydrated.value) return
  const target = event.target as HTMLElement
  if (target.closest('button, [role="combobox"], [data-slot="select-trigger"]')) return
  emit('open', task.id)
}
</script>

<template>
  <div :class="embedded ? 'space-y-0' : 'space-y-2'">
    <div :class="embedded ? '' : 'nasq-panel overflow-hidden'">
      <div class="hidden overflow-x-auto md:block">
        <Table class="table-fixed min-w-[760px]">
        <!--
          `table-fixed` + an explicit colgroup keeps the title column at
          >=50% of the row's width. That's not just cosmetic: the title is
          the row's click-to-open target, and a click on the row lands at
          its bounding-box's horizontal center — with the title column
          always covering that midpoint, "click the row" reliably opens it
          instead of landing on the narrower state/priority controls.
        -->
        <colgroup>
          <col v-for="(cls, i) in colgroupClasses" :key="i" :class="cls" />
        </colgroup>
        <TableHeader>
          <TableRow v-for="headerGroup in table.getHeaderGroups()" :key="headerGroup.id">
            <TableHead v-for="header in headerGroup.headers" :key="header.id" class="text-start">
              <FlexRender v-if="!header.isPlaceholder" :render="header.column.columnDef.header" :props="header.getContext()" />
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <template v-if="isLoading">
            <TableRow v-for="n in 5" :key="n">
              <TableCell v-for="col in columns" :key="col.id">
                <Skeleton class="h-5 w-full" />
              </TableCell>
            </TableRow>
          </template>
          <TableEmpty v-else-if="error" :colspan="columns.length">
            <SharedPageState :error="error" @retry="refetch" />
          </TableEmpty>
          <TableEmpty v-else-if="items.length === 0" :colspan="columns.length">
            <EmptyState :title="t(emptyTitleKey)">
              <template v-if="showCreateAction" #action>
                <Button size="sm" :disabled="!hydrated" @click="emit('create')">{{ t('tasks.empty.action') }}</Button>
              </template>
            </EmptyState>
          </TableEmpty>
          <template v-else>
            <TableRow
              v-for="row in table.getRowModel().rows"
              :key="row.id"
              class="cursor-pointer"
              @click="onRowClick(row.original, $event)"
            >
              <TableCell v-for="cell in row.getVisibleCells()" :key="cell.id" class="max-w-0 overflow-hidden text-ellipsis whitespace-nowrap">
                <FlexRender :render="cell.column.columnDef.cell" :props="cell.getContext()" />
              </TableCell>
            </TableRow>
          </template>
        </TableBody>
        </Table>
      </div>

      <div class="divide-y md:hidden">
        <template v-if="isLoading">
          <div v-for="n in 5" :key="`mobile-skeleton-${n}`" class="space-y-3 p-4">
            <Skeleton class="h-5 w-4/5" />
            <Skeleton class="h-4 w-2/5" />
            <div class="flex gap-2"><Skeleton class="h-6 w-20" /><Skeleton class="h-6 w-20" /></div>
          </div>
        </template>
        <div v-else-if="error" class="p-6 text-center">
          <SharedPageState :error="error" @retry="refetch" />
        </div>
        <div v-else-if="items.length === 0" class="p-6 text-center">
          <EmptyState :title="t(emptyTitleKey)">
            <template v-if="showCreateAction" #action>
              <Button size="sm" :disabled="!hydrated" @click="emit('create')">
                {{ t('tasks.empty.action') }}
              </Button>
            </template>
          </EmptyState>
        </div>
        <template v-else>
          <article
            v-for="task in items"
            :key="`mobile-${task.id}`"
            class="space-y-3 p-4"
            :class="hydrated ? 'cursor-pointer active:bg-muted/50' : ''"
            @click="onRowClick(task, $event)"
          >
            <div class="flex items-start justify-between gap-3">
              <button type="button" class="min-w-0 flex-1 truncate rounded-sm text-start font-medium hover:underline" :disabled="!hydrated" @click.stop="emit('open', task.id)">{{ task.name }}</button>
              <DeadlineBadge
                class="shrink-0"
                :deadline="task.date_deadline"
                :days-remaining="task.days_remaining"
                :is-closed="task.is_closed"
              />
            </div>
            <p class="truncate text-sm text-muted-foreground">
              {{ task.project?.name ?? (props.variant === 'project' ? task.stage?.name : '—') }}
            </p>
            <div class="flex flex-wrap items-center gap-2">
              <StateMenu :task="task" />
              <PrioritySelect :task="task" />
              <span v-if="props.variant === 'project' && task.stage" class="text-xs text-muted-foreground">
                {{ task.stage.name }}
              </span>
              <span v-else-if="task.personal_stage" class="text-xs text-muted-foreground">
                {{ task.personal_stage.name }}
              </span>
            </div>
          </article>
        </template>
      </div>
    </div>
    <div v-if="hasNextPage" class="flex justify-center">
      <Button variant="outline" size="sm" :disabled="isFetchingNextPage || !hydrated" @click="fetchNextPage()">
        {{ t('app.loadMore') }}
      </Button>
    </div>
  </div>
</template>
