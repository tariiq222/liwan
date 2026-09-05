<script setup lang="ts">
import type { Project } from '@nasq/contracts'
import { FlexRender, createColumnHelper, getCoreRowModel, useVueTable } from '@tanstack/vue-table'
import { h } from 'vue'
import ProjectMenu from './ProjectMenu.vue'
import ProjectProgress from './ProjectProgress.vue'
import ProjectStatusBadge from './ProjectStatusBadge.vue'

const props = defineProps<{ items: Project[]; isLoading: boolean; archived: boolean; capped: boolean; filtered: boolean }>()
const emit = defineEmits<{ open: [id: number] }>()

const { t } = useI18n()
const hydrated = useHydrated()

const columnHelper = createColumnHelper<Project>()
const columns = [
  columnHelper.accessor('name', {
    id: 'name',
    header: () => t('projects.columns.name'),
  }),
  columnHelper.display({
    id: 'status',
    header: () => t('projects.columns.status'),
    cell: (info) => h(ProjectStatusBadge, { status: info.row.original.status }),
  }),
  columnHelper.display({
    id: 'progress',
    header: () => t('projects.columns.progress'),
    cell: (info) =>
      h(ProjectProgress, {
        progress: info.row.original.progress,
        taskCount: info.row.original.task_count,
        closedTaskCount: info.row.original.closed_task_count,
        compact: true,
      }),
  }),
  columnHelper.display({
    id: 'menu',
    header: () => '',
    // Settings live on the project page, not the table row — only
    // archive/unarchive is reachable from here.
    cell: (info) => h(ProjectMenu, { project: info.row.original, hideSettings: true }),
  }),
]

const table = useVueTable({
  get data() {
    return props.items
  },
  columns,
  getCoreRowModel: getCoreRowModel(),
})
</script>

<template>
  <div class="space-y-2">
    <div class="rounded-md border">
      <Table class="table-fixed">
        <colgroup>
          <col class="w-[40%]" />
          <col class="w-[20%]" />
          <col class="w-[30%]" />
          <col class="w-[10%]" />
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
            <div class="space-y-1 py-3 text-center">
              <p class="font-medium">{{ t(filtered ? 'projects.filteredEmpty' : archived ? 'projects.archivedEmpty' : 'projects.empty') }}</p>
              <p class="text-sm text-muted-foreground">{{ t(filtered ? 'projects.filteredEmptyHint' : archived ? 'projects.archivedEmptyHint' : 'projects.emptyHint') }}</p>
            </div>
          </TableEmpty>
          <template v-else>
            <TableRow
              v-for="row in table.getRowModel().rows"
              :key="row.id"
              class="cursor-pointer"
              data-testid="project-row"
              @click="hydrated && emit('open', row.original.id)"
            >
              <TableCell v-for="cell in row.getVisibleCells()" :key="cell.id">
                <FlexRender :render="cell.column.columnDef.cell" :props="cell.getContext()" />
              </TableCell>
            </TableRow>
          </template>
        </TableBody>
      </Table>
    </div>
    <p v-if="capped" class="text-xs text-muted-foreground">{{ t('projects.capped') }}</p>
  </div>
</template>
