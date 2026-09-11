<script setup lang="ts">
import type { Project } from '@nasq/contracts'
import ProjectMenu from './ProjectMenu.vue'
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
  filtered: boolean
  capped?: boolean
  toFor: (project: ProjectListItem) => RouteLocationRaw
}>()
const emit = defineEmits<{ open: [id: number] }>()
const { t, locale } = useI18n()
const hydrated = useHydrated()

function open(project: Project, event: MouseEvent) {
  if (!hydrated.value || (event.target as HTMLElement).closest('a, button, [role="menu"]')) return
  emit('open', project.id)
}
function openWithKeyboard(project: Project, event: KeyboardEvent) {
  if (event.target !== event.currentTarget || (event.key !== 'Enter' && event.key !== ' ')) return
  event.preventDefault()
  if (!hydrated.value) return
  emit('open', project.id)
}
</script>

<template>
  <div v-if="isLoading" class="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
    <USkeleton v-for="n in 6" :key="n" class="h-44 rounded-xl" />
  </div>
  <div v-else-if="items.length === 0" class="nasq-ui-record-surface p-6">
    <EmptyState
      :title="t(filtered ? 'projects.filteredEmpty' : archived ? 'projects.archivedEmpty' : 'projects.empty')"
      :description="t(filtered ? 'projects.filteredEmptyHint' : archived ? 'projects.archivedEmptyHint' : 'projects.emptyHint')"
    />
  </div>
  <div v-else class="space-y-2">
    <div class="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      <article
        v-for="project in items"
        :key="project.id"
        class="flex cursor-pointer flex-col gap-4 rounded-xl border border-default bg-default p-5 transition-colors hover:border-brand-border hover:bg-elevated/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        data-testid="project-card"
        tabindex="0"
        :aria-labelledby="`project-card-${project.id}`"
        @click="open(project, $event)"
        @keydown="openWithKeyboard(project, $event)"
      >
        <div class="flex items-start justify-between gap-3">
          <div class="min-w-0">
            <RecordNumber :value="project.id" />
            <h2 :id="`project-card-${project.id}`" class="mt-1 truncate text-base font-semibold text-highlighted"><NuxtLink :to="toFor(project)" class="hover:underline">{{ project.name }}</NuxtLink></h2>
          </div>
          <ProjectStatusBadge :status="project.status" class="shrink-0" />
        </div>
        <div class="space-y-2">
          <div class="flex items-center justify-between gap-3 text-xs text-muted">
            <span>{{ t('projects.progressOf', { closed: project.closed_task_count, total: project.task_count }) }}</span>
            <span class="tabular-nums font-medium text-highlighted">{{ project.progress }}%</span>
          </div>
          <UProgress :model-value="project.progress" :style="{ '--nasq-ui-progress': `${Math.min(100, Math.max(0, project.progress))}%` }" class="nasq-ui-progress" size="sm" :aria-label="t('projects.columns.progress')" />
        </div>
        <div class="mt-auto flex items-center justify-between gap-3 border-t border-default pt-3 text-xs text-muted">
          <span class="inline-flex min-w-0 items-center gap-1.5">
            <UIcon name="i-lucide-user-round" class="size-4 shrink-0" aria-hidden="true" />
            <span class="sr-only">{{ t('projects.columns.manager') }}: </span>
            <span class="truncate">{{ project.manager?.name ?? '—' }}</span>
          </span>
          <span class="inline-flex shrink-0 items-center gap-2">
            <span class="inline-flex items-center gap-1.5">
              <UIcon name="i-lucide-calendar-days" class="size-4" aria-hidden="true" />
              <span class="sr-only">{{ t('projects.columns.dateEnd') }}: </span>
              <span>{{ project.date_end ? formatCalendarDate(project.date_end, locale) : '—' }}</span>
            </span>
            <ProjectMenu :project="project" hide-settings />
          </span>
        </div>
      </article>
    </div>
    <p v-if="capped" class="text-xs text-muted">{{ t('projects.capped') }}</p>
  </div>
</template>
