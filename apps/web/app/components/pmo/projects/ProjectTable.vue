<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import type { Project, ProjectStatus } from '@nasq/contracts'
import type { RouteLocationRaw } from 'vue-router'
import { formatCalendarDate } from '@nasq/ui/app/composables/calendarDate'
import { projectStatusBadge } from '@/composables/projectStatus'
import { badgeLabel } from '@nasq/ui/app/utils/statusBadge'
import RecordNumber from '@nasq/ui/app/components/shared/data/RecordNumber.vue'
import ProjectCardBody from './ProjectCardBody.vue'
import ProjectMenu from './ProjectMenu.vue'
import ProjectProgress from './ProjectProgress.vue'

// The table view of /projects on SharedDataTable. A background click and Enter on a row open the
// project through `toFor`; the name link's plain click goes through `open`, so the page can first
// commit the search being typed. Empty, error and pagination belong to the page.
type ProjectListItem = Project & { manager?: { id: number; name: string } | null; date_end?: string | null }
defineProps<{
  items: ProjectListItem[]
  isLoading: boolean
  toFor: (project: ProjectListItem) => RouteLocationRaw
}>()
const emit = defineEmits<{ open: [id: number] }>()

const { t, locale } = useI18n()
const projectBadge = (status: ProjectStatus | null) => { const entry = projectStatusBadge(status); return { tone: entry.tone, label: badgeLabel(entry, status, t) } }
const hydrated = useHydrated()

const columns = computed<TableColumn<ProjectListItem>[]>(() => [
  { accessorKey: 'id', header: t('app.recordNumber') },
  { accessorKey: 'name', header: t('projects.columns.name') },
  { accessorKey: 'manager', header: t('projects.columns.manager') },
  { accessorKey: 'status', header: t('projects.columns.status') },
  { accessorKey: 'date_end', header: t('projects.columns.dateEnd') },
  { accessorKey: 'progress', header: t('projects.columns.progress') },
  { accessorKey: 'menu', header: t('app.actions') },
])

function openLink(project: ProjectListItem, event: MouseEvent) {
  if (!hydrated.value) return
  event.stopPropagation()
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return
  event.preventDefault()
  emit('open', project.id)
}
</script>

<template>
  <SharedDataTable :rows="items" :columns="columns" row-key="id" :row-to="toFor" :loading="isLoading" :caption="t('projects.title')">
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
          class="block min-w-0 truncate font-medium hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          @click="openLink(row.original, $event)"
        >{{ row.original.name }}</a>
      </NuxtLink>
    </template>
    <template #manager-cell="{ row }">{{ row.original.manager?.name ?? '—' }}</template>
    <template #status-cell="{ row }"><SharedStatusBadge v-bind="projectBadge(row.original.status)" data-testid="project-status" /></template>
    <template #date_end-cell="{ row }">{{ row.original.date_end ? formatCalendarDate(row.original.date_end, locale) : '—' }}</template>
    <template #progress-cell="{ row }">
      <ProjectProgress :progress="row.original.progress" :task-count="row.original.task_count" :closed-task-count="row.original.closed_task_count" compact />
    </template>
    <template #menu-cell="{ row }">
      <ProjectMenu :project="row.original" :to="toFor(row.original)" hide-settings @click.stop />
    </template>
    <template #mobile-row="{ row }">
      <ProjectCardBody :project="row" :to-for="toFor" />
    </template>
  </SharedDataTable>
</template>
