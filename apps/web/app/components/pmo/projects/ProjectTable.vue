<script setup lang="ts">
import { recordNumberHeader } from '@webvue/ui/app/utils/recordNumberHeader'
import type { TableColumn } from '@nuxt/ui'
import type { Project } from '@webvue/contracts'
import type { RouteLocationRaw } from 'vue-router'
import RecordNumber from '@webvue/ui/app/components/shared/data/RecordNumber.vue'
import { projectEndTagView, projectProgressTone, projectStatusPill } from './projectHealth'
import ProjectCardBody from './ProjectCardBody.vue'
import ProjectMenu from './ProjectMenu.vue'
import ProjectProgress from './ProjectProgress.vue'

// The table view of /projects on a bare SharedDataTable: the page wraps it in a SharedListCard whose header row holds the
// filter bar and whose last row is the `footer` slot. A background click and Enter on a row open the project through
// `toFor`; the name link's plain click goes through `open`, so the page can first commit the search being typed. Empty,
// error and paging belong to the page. The server has one sort order per key, not a direction, so no header sorts.
type ProjectListItem = Project & { manager?: { id: number; name: string } | null; date_end?: string | null }
defineProps<{
  items: ProjectListItem[]
  isLoading: boolean
  toFor: (project: ProjectListItem) => RouteLocationRaw
}>()
const emit = defineEmits<{ open: [id: number] }>()

const { t } = useI18n()
const hydrated = useHydrated()

// Narrow columns are fixed px (a pill or an avatar never clips), the name absorbs the rest and truncates; `fit` columns
// never clip. The table's minimum width is the sum of its columns (the name at its floor), and below it the table scrolls sideways.
const WIDTH = {
  number: 'w-[48px] min-w-[48px] px-2',
  name: 'min-w-[240px]',
  manager: 'w-[104px] min-w-[104px]',
  status: 'w-[128px] min-w-[128px]',
  dateEnd: 'w-[152px] min-w-[152px]',
  progress: 'w-[208px] min-w-[208px]',
  menu: 'w-[56px] min-w-[56px]',
}
function column(id: string, header: TableColumn<ProjectListItem>['header'], width: string, fit = false): TableColumn<ProjectListItem> {
  const cell = fit ? 'whitespace-nowrap' : 'max-w-0 overflow-hidden text-ellipsis whitespace-nowrap'
  return { id, header, meta: { class: { th: `text-start ${width}`, td: `${cell} ${width}` } } as TableColumn<ProjectListItem>['meta'] }
}
const columns = computed<TableColumn<ProjectListItem>[]>(() => [
  column('id', () => recordNumberHeader(t), WIDTH.number, true),
  column('name', t('projects.columns.name'), WIDTH.name),
  column('manager', t('projects.columns.manager'), WIDTH.manager, true),
  column('status', t('projects.columns.status'), WIDTH.status, true),
  column('date_end', t('projects.columns.dateEnd'), WIDTH.dateEnd, true),
  column('progress', t('projects.columns.progress'), WIDTH.progress, true),
  column('menu', t('app.actions'), WIDTH.menu, true),
])

const endTag = (project: ProjectListItem) => projectEndTagView(project, t)

function openLink(project: ProjectListItem, event: MouseEvent) {
  if (!hydrated.value) return
  event.stopPropagation()
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return
  event.preventDefault()
  emit('open', project.id)
}
</script>

<template>
  <div class="min-w-0 [&_table]:w-full [&_table]:min-w-[max(100%,928px)] [&_table]:table-fixed">
    <SharedDataTable bare :rows="items" :columns="columns" row-key="id" :row-to="toFor" :loading="isLoading" :caption="t('projects.title')">
      <template #id-cell="{ row }"><RecordNumber :value="row.original.id" /></template>
      <template #name-cell="{ row }">
        <NuxtLink
          v-slot="{ href }"
          :to="toFor(row.original)"
          custom
        >
          <!-- One plain-click owner flushes the search; the real href keeps native modified clicks. -->
          <a
            :href="href ?? undefined"
            data-testid="project-row"
            class="block min-w-0 truncate text-base font-semibold text-highlighted hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            :title="row.original.name"
            @click="openLink(row.original, $event)"
          >{{ row.original.name }}</a>
        </NuxtLink>
      </template>
      <template #manager-cell="{ row }"><SharedPersonAvatar :people="row.original.manager ? [row.original.manager] : []" /></template>
      <template #status-cell="{ row }"><SharedStatusBadge v-bind="projectStatusPill(row.original.status, t)" data-testid="project-status" /></template>
      <template #date_end-cell="{ row }">
        <SharedStatusBadge v-if="endTag(row.original)" v-bind="endTag(row.original)!" size="sm" data-testid="project-end-date" :aria-label="`${endTag(row.original)!.label} ${endTag(row.original)!.title}`" />
        <span v-else class="text-muted">—</span>
      </template>
      <template #progress-cell="{ row }">
        <ProjectProgress :progress="row.original.progress" :task-count="row.original.task_count" :closed-task-count="row.original.closed_task_count" :tone="projectProgressTone(row.original)" />
      </template>
      <template #menu-cell="{ row }">
        <ProjectMenu :project="row.original" :to="toFor(row.original)" hide-settings @click.stop />
      </template>
      <template #mobile-row="{ row }">
        <ProjectCardBody :project="row" :to-for="toFor" />
      </template>
    </SharedDataTable>
  </div>
</template>
