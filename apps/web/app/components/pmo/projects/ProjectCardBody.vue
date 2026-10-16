<script setup lang="ts">
import type { Project, ProjectStatus } from '@nasq/contracts'
import type { RouteLocationRaw } from 'vue-router'
import { formatCalendarDate } from '@nasq/ui/app/composables/calendarDate'
import { projectStatusBadge } from '@/composables/projectStatus'
import { badgeLabel } from '@/utils/statusBadge'
import RecordNumber from '@nasq/ui/app/components/shared/data/RecordNumber.vue'
import ProjectMenu from './ProjectMenu.vue'

// One project as a body: number, name, status, progress, manager, end date and the actions menu.
// It is the inside of a card (ProjectCards) and of a phone row of the table (ProjectTable's
// #mobile-row), so both show the same information. The caller owns the surface around it.
type ProjectListItem = Project & { manager?: { id: number; name: string } | null; date_end?: string | null }
defineProps<{ project: ProjectListItem; toFor: (project: ProjectListItem) => RouteLocationRaw }>()
const { t, locale } = useI18n()
const projectBadge = (status: ProjectStatus | null) => { const entry = projectStatusBadge(status); return { tone: entry.tone, label: badgeLabel(entry, status, t) } }
</script>

<template>
  <div class="flex flex-col gap-4">
    <div class="flex items-start justify-between gap-3">
      <div class="flex min-w-0 items-baseline gap-2">
        <RecordNumber :value="project.id" class="shrink-0" />
        <h2 :id="`project-card-${project.id}`" class="min-w-0 truncate text-base font-semibold text-highlighted">
          <NuxtLink :to="toFor(project)" class="rounded hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">{{ project.name }}</NuxtLink>
        </h2>
      </div>
      <SharedStatusBadge v-bind="projectBadge(project.status)" data-testid="project-status" class="shrink-0" />
    </div>
    <div class="space-y-2">
      <div class="flex items-center justify-between gap-3 text-xs text-muted">
        <span>{{ t('projects.progressOf', { closed: project.closed_task_count, total: project.task_count }, project.task_count) }}</span>
        <span class="tabular-nums font-medium text-highlighted">{{ project.progress }}%</span>
      </div>
      <UProgress :model-value="project.progress" size="sm" :aria-label="t('projects.columns.progress')" />
    </div>
    <div class="mt-auto box-content flex min-h-(--nasq-control-h) flex-wrap items-center gap-x-3 gap-y-2 border-t border-default pt-3 text-xs text-muted">
      <span class="inline-flex min-w-0 flex-1 items-center gap-1.5">
        <UIcon name="i-lucide-user-round" class="size-4 shrink-0" aria-hidden="true" />
        <span class="sr-only">{{ t('projects.columns.manager') }}: </span>
        <span class="truncate">{{ project.manager?.name ?? '—' }}</span>
      </span>
      <span class="inline-flex shrink-0 items-center gap-1.5">
        <UIcon name="i-lucide-calendar-days" class="size-4" aria-hidden="true" />
        <span class="sr-only">{{ t('projects.columns.dateEnd') }}: </span>
        <span>{{ project.date_end ? formatCalendarDate(project.date_end, locale) : '—' }}</span>
      </span>
      <ProjectMenu v-if="project.can_manage" :project="project" hide-settings />
    </div>
  </div>
</template>
