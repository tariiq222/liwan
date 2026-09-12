<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import type { Project } from '@nasq/contracts'
import ProjectCards from './ProjectCards.vue'
import ProjectMenu from './ProjectMenu.vue'
import ProjectProgress from './ProjectProgress.vue'
import ProjectStatusBadge from './ProjectStatusBadge.vue'
import EmptyState from '@/components/shared/EmptyState.vue'
import RecordNumber from '@/components/shared/RecordNumber.vue'
import type { RouteLocationRaw } from 'vue-router'
import { formatCalendarDate } from '@/composables/calendarDate'

type ProjectListItem = Project & { manager?: { id: number; name: string } | null; date_end?: string | null }
const props = defineProps<{
  items: ProjectListItem[]
  isLoading: boolean
  archived: boolean
  capped: boolean
  filtered: boolean
  toFor: (project: ProjectListItem) => RouteLocationRaw
}>()
const emit = defineEmits<{ open: [id: number] }>()

const { t, locale } = useI18n()
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

function onSelectRow(_event: Event, row: { original: ProjectListItem }) {
  if (!hydrated.value) return
  emit('open', row.original.id)
}
</script>

<template>
  <div class="min-w-0 space-y-2">
    <!-- Desktop: real UTable. Mobile: readable record cards via ProjectCards. -->
    <div class="hidden md:block">
      <div v-if="isLoading" class="nasq-ui-record-surface divide-y divide-default" role="status" :aria-label="t('app.loading')">
        <div v-for="n in 5" :key="n" class="flex items-center gap-4 px-4 py-3">
          <USkeleton class="h-5 w-10" />
          <USkeleton class="h-5 flex-1" />
          <USkeleton class="h-5 w-24" />
          <USkeleton class="h-5 w-20" />
          <USkeleton class="h-5 w-24" />
          <USkeleton class="h-5 w-32" />
          <USkeleton class="h-5 w-8" />
        </div>
      </div>
      <div v-else-if="items.length === 0" class="nasq-ui-record-surface p-6">
        <EmptyState
          :title="t(filtered ? 'projects.filteredEmpty' : archived ? 'projects.archivedEmpty' : 'projects.empty')"
          :description="t(filtered ? 'projects.filteredEmptyHint' : archived ? 'projects.archivedEmptyHint' : 'projects.emptyHint')"
        />
      </div>
      <div v-else class="nasq-ui-record-surface">
        <div class="overflow-x-auto">
          <UTable :data="items" :columns="columns" :caption="t('projects.title')" :ui="{ caption: 'sr-only', thead: 'nasq-ui-table-head' }" @select="onSelectRow">
            <template #id-cell="{ row }"><RecordNumber :value="row.original.id" /></template>
            <template #name-cell="{ row }">
              <NuxtLink
                :to="toFor(row.original)"
                data-testid="project-row"
                class="block min-w-0 truncate font-medium hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                @click="openLink(row.original, $event)"
              >{{ row.original.name }}</NuxtLink>
            </template>
            <template #manager-cell="{ row }">{{ row.original.manager?.name ?? '—' }}</template>
            <template #status-cell="{ row }"><ProjectStatusBadge :status="row.original.status" /></template>
            <template #date_end-cell="{ row }">{{ row.original.date_end ? formatCalendarDate(row.original.date_end, locale) : '—' }}</template>
            <template #progress-cell="{ row }">
              <ProjectProgress :progress="row.original.progress" :task-count="row.original.task_count" :closed-task-count="row.original.closed_task_count" compact />
            </template>
            <template #menu-cell="{ row }">
              <ProjectMenu :project="row.original" hide-settings @click.stop />
            </template>
          </UTable>
        </div>
      </div>
    </div>
    <ProjectCards
      class="md:hidden"
      :items="items"
      :is-loading="isLoading"
      :archived="archived"
      :filtered="filtered"
      :capped="false"
      :to-for="toFor"
      @open="emit('open', $event)"
    />
    <p v-if="capped" class="text-xs text-muted">{{ t('projects.capped') }}</p>
  </div>
</template>
