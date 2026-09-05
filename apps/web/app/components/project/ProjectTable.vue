<script setup lang="ts">
import type { Project } from '@nasq/contracts'
import { FlexRender, createColumnHelper, getCoreRowModel, useVueTable } from '@tanstack/vue-table'
import { h } from 'vue'
import { useProjectList } from '@/composables/useProjects'
import ProjectMenu from './ProjectMenu.vue'
import ProjectProgress from './ProjectProgress.vue'
import ProjectStatusBadge from './ProjectStatusBadge.vue'

// Defaults to the active list so a caller that doesn't yet pass `archived`
// (the filter chips land on the page in Task 14) keeps today's behaviour.
const props = withDefaults(defineProps<{ archived?: boolean }>(), { archived: false })
const emit = defineEmits<{ open: [id: number]; create: [] }>()

const { t } = useI18n()
const hydrated = useHydrated()

const archived = toRef(props, 'archived')
const { data, isLoading } = useProjectList(archived)
const items = computed<Project[]>(() => data.value?.items ?? [])

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
    return items.value
  },
  columns,
  getCoreRowModel: getCoreRowModel(),
})
</script>

<template>
  <div class="space-y-2">
    <div v-if="data?.can_create" class="flex justify-end">
      <Button data-testid="project-new" :disabled="!hydrated" @click="emit('create')">
        {{ t('projects.new') }}
      </Button>
    </div>
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
            <p class="text-muted-foreground">{{ t(archived ? 'projects.archivedEmpty' : 'projects.empty') }}</p>
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
    <p v-if="(data?.items.length ?? 0) >= 200" class="text-xs text-muted-foreground">{{ t('projects.capped') }}</p>
  </div>
</template>
