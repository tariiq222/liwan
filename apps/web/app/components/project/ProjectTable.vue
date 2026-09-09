<script setup lang="ts">
import type { Project } from '@nasq/contracts'
import { FlexRender, createColumnHelper, getCoreRowModel, useVueTable } from '@tanstack/vue-table'
import { h, resolveComponent } from 'vue'
import ProjectMenu from './ProjectMenu.vue'
import ProjectProgress from './ProjectProgress.vue'
import ProjectStatusBadge from './ProjectStatusBadge.vue'
import EmptyState from '@/components/shared/EmptyState.vue'
import RecordNumber from '@/components/shared/RecordNumber.vue'
import { formatCalendarDate } from '@/composables/calendarDate'
import { returnToQuery } from '@/utils/safeReturnTo'

type ProjectListItem = Project & { manager?: { id: number; name: string } | null; date_end?: string | null }
const props = defineProps<{ items: ProjectListItem[]; isLoading: boolean; archived: boolean; capped: boolean; filtered: boolean }>()
const emit = defineEmits<{ open: [id: number] }>()

const { t, locale } = useI18n()
const hydrated = useHydrated()
const NuxtLink = resolveComponent('NuxtLink')
const route = useRoute()

const columnHelper = createColumnHelper<ProjectListItem>()
const columns = [
  columnHelper.display({
    id: 'record_number',
    header: () => t('app.recordNumber'),
    cell: (info) => h(RecordNumber, { value: info.row.original.id }),
  }),
  columnHelper.accessor('name', {
    id: 'name',
    header: () => t('projects.columns.name'),
    cell: (info) => h('div', { class: 'min-w-0' }, [
      h(NuxtLink, {
        to: { path: `/projects/${info.row.original.id}`, query: returnToQuery(route.fullPath) },
        class: 'block truncate font-medium hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        onClick: (event: MouseEvent) => event.stopPropagation(),
      }, () => info.row.original.name),
    ]),
  }),
  columnHelper.display({
    id: 'manager',
    header: () => t('projects.columns.manager'),
    cell: (info) => info.row.original.manager?.name ?? '—',
  }),
  columnHelper.display({
    id: 'status',
    header: () => t('projects.columns.status'),
    cell: (info) => h(ProjectStatusBadge, { status: info.row.original.status }),
  }),
  columnHelper.display({
    id: 'date_end',
    header: () => t('projects.columns.dateEnd'),
    cell: (info) => info.row.original.date_end ? formatCalendarDate(info.row.original.date_end, locale.value) : '—',
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
  <div class="min-w-0 space-y-2">
    <div class="nasq-panel overflow-hidden">
      <div class="overflow-x-auto">
      <Table class="table-fixed min-w-[860px]" :aria-label="t('projects.title')">
        <colgroup>
          <col class="w-[10%]" />
          <col class="w-[30%]" />
          <col class="w-[12%]" />
          <col class="w-[12%]" />
          <col class="w-[12%]" />
          <col class="w-[18%]" />
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
          <!--
            Vue Query can finish between the server render and client
            hydration. Keep the initial table shape deterministic so rows
            are mounted with their click handlers instead of being patched
            over SSR skeletons during hydration.
          -->
          <template v-if="isLoading || !hydrated">
            <TableRow v-for="n in 5" :key="n">
              <TableCell v-for="col in columns" :key="col.id">
                <Skeleton class="h-5 w-full" />
              </TableCell>
            </TableRow>
          </template>
          <TableEmpty v-else-if="items.length === 0" :colspan="columns.length">
            <EmptyState
              :title="t(filtered ? 'projects.filteredEmpty' : archived ? 'projects.archivedEmpty' : 'projects.empty')"
              :description="t(filtered ? 'projects.filteredEmptyHint' : archived ? 'projects.archivedEmptyHint' : 'projects.emptyHint')"
            />
          </TableEmpty>
          <template v-else>
            <TableRow
              v-for="row in table.getRowModel().rows"
              :key="row.original.id"
              class="cursor-pointer transition-colors hover:bg-muted/40"
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
    </div>
    <p v-if="capped" class="text-xs text-muted-foreground">{{ t('projects.capped') }}</p>
  </div>
</template>
