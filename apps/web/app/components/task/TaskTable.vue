<script setup lang="ts">
import type { Task, TaskState } from '@nasq/contracts'
import { FlexRender, createColumnHelper, getCoreRowModel, useVueTable } from '@tanstack/vue-table'
import { h } from 'vue'
import type { TaskListParams } from '@/composables/useTasks'
import { useTasks } from '@/composables/useTasks'
import DeadlineBadge from './DeadlineBadge.vue'
import PrioritySelect from './PrioritySelect.vue'
import StateMenu from './StateMenu.vue'

const props = defineProps<{ params: TaskListParams }>()
const emit = defineEmits<{
  open: [id: number]
  transition: [payload: { id: number; state: TaskState }]
  create: []
}>()

const { t } = useI18n()

const paramsRef = computed(() => props.params)
const { data, isLoading, hasNextPage, fetchNextPage, isFetchingNextPage } = useTasks(paramsRef)

const items = computed<Task[]>(() => data.value?.pages.flatMap((page) => page.items) ?? [])
// A search/state/project filter yielding zero rows is a different situation
// from genuinely having no tasks — the empty state (with a "create" action)
// only makes sense when nothing is filtered out.
const hasActiveFilters = computed(() => !!props.params.q || !!props.params.project_id || !!props.params.state?.length)

const columnHelper = createColumnHelper<Task>()
const columns = [
  columnHelper.accessor('name', {
    id: 'title',
    header: () => t('tasks.columns.title'),
  }),
  columnHelper.display({
    id: 'project',
    header: () => t('tasks.columns.project'),
    cell: (info) => info.row.original.project?.name ?? '—',
  }),
  columnHelper.display({
    id: 'state',
    header: () => t('tasks.columns.state'),
    cell: (info) =>
      h(StateMenu, {
        task: info.row.original,
        onTransition: (state: TaskState) => emit('transition', { id: info.row.original.id, state }),
      }),
  }),
  columnHelper.display({
    id: 'deadline',
    header: () => t('tasks.columns.deadline'),
    cell: (info) =>
      h(DeadlineBadge, {
        deadline: info.row.original.date_deadline,
        daysRemaining: info.row.original.days_remaining,
        isClosed: info.row.original.is_closed,
      }),
  }),
  columnHelper.display({
    id: 'priority',
    header: () => t('tasks.columns.priority'),
    cell: (info) => h(PrioritySelect, { task: info.row.original }),
  }),
  columnHelper.display({
    id: 'stage',
    header: () => t('tasks.columns.stage'),
    cell: (info) => info.row.original.personal_stage?.name ?? '—',
  }),
]

const table = useVueTable({
  get data() {
    return items.value
  },
  columns,
  getCoreRowModel: getCoreRowModel(),
})

// The state/priority cells are interactive controls of their own (dropdown
// trigger, select trigger); a click that lands on one of them must not also
// open the row.
function onRowClick(task: Task, event: MouseEvent) {
  const target = event.target as HTMLElement
  if (target.closest('button, [role="combobox"], [data-slot="select-trigger"]')) return
  emit('open', task.id)
}
</script>

<template>
  <div class="space-y-2">
    <div class="rounded-md border">
      <Table class="table-fixed">
        <!--
          `table-fixed` + an explicit colgroup keeps the title column at
          >=50% of the row's width. That's not just cosmetic: the title is
          the row's click-to-open target, and a click on the row lands at
          its bounding-box's horizontal center — with the title column
          always covering that midpoint, "click the row" reliably opens it
          instead of landing on the narrower state/priority controls.
        -->
        <colgroup>
          <col class="w-[52%]" />
          <col class="w-[12%]" />
          <col class="w-[10%]" />
          <col class="w-[10%]" />
          <col class="w-[10%]" />
          <col class="w-[6%]" />
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
          <TableEmpty v-else-if="items.length === 0" :colspan="columns.length">
            <div class="flex flex-col items-center gap-2 text-center">
              <p class="text-muted-foreground">{{ hasActiveFilters ? t('app.noResults') : t('tasks.empty.title') }}</p>
              <Button v-if="!hasActiveFilters" size="sm" @click="emit('create')">{{ t('tasks.empty.action') }}</Button>
            </div>
          </TableEmpty>
          <template v-else>
            <TableRow
              v-for="row in table.getRowModel().rows"
              :key="row.id"
              class="cursor-pointer"
              @click="onRowClick(row.original, $event)"
            >
              <TableCell v-for="cell in row.getVisibleCells()" :key="cell.id">
                <FlexRender :render="cell.column.columnDef.cell" :props="cell.getContext()" />
              </TableCell>
            </TableRow>
          </template>
        </TableBody>
      </Table>
    </div>
    <div v-if="hasNextPage" class="flex justify-center">
      <Button variant="outline" size="sm" :disabled="isFetchingNextPage" @click="fetchNextPage()">
        {{ t('app.loadMore') }}
      </Button>
    </div>
  </div>
</template>
