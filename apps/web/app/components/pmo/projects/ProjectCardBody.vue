<script setup lang="ts">
import type { Project } from '@webvue/contracts'
import type { RouteLocationRaw } from 'vue-router'
import RecordNumber from '@webvue/ui/app/components/shared/data/RecordNumber.vue'
import { projectEndTagView, projectProgressTone, projectStatusPill } from './projectHealth'
import ProjectMenu from './ProjectMenu.vue'

// One project as a body: number and status, name and manager, progress, end date and the actions menu.
// It is the inside of a card (ProjectCards) and of a phone row of the table (ProjectTable's #mobile-row), so both
// show the same information. The caller owns the surface around it.
type ProjectListItem = Project & { manager?: { id: number; name: string } | null; date_end?: string | null }
const props = defineProps<{ project: ProjectListItem; toFor: (project: ProjectListItem) => RouteLocationRaw }>()
const { t } = useI18n()
const endTag = computed(() => projectEndTagView(props.project, t))
</script>

<template>
  <div class="flex h-full min-w-0 flex-col gap-3">
    <div class="flex items-center justify-between gap-2">
      <RecordNumber :value="project.id" />
      <SharedStatusBadge v-bind="projectStatusPill(project.status, t)" data-testid="project-status" class="shrink-0" />
    </div>
    <div class="min-w-0">
      <h2 :id="`project-card-${project.id}`" class="line-clamp-2 text-sm font-semibold text-highlighted" :title="project.name">
        <NuxtLink :to="toFor(project)" class="rounded hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">{{ project.name }}</NuxtLink>
      </h2>
      <p class="mt-0.5 truncate text-xs text-muted">
        <span class="sr-only">{{ t('projects.columns.manager') }}: </span>{{ project.manager?.name ?? '—' }}
      </p>
    </div>
    <div class="grid gap-1.5">
      <div class="flex items-baseline justify-between gap-2">
        <span class="min-w-0 truncate text-xs text-muted">{{ t('projects.progressOf', { closed: project.closed_task_count, total: project.task_count }, project.task_count) }}</span>
        <span class="shrink-0 text-xl font-semibold tabular-nums text-highlighted" data-testid="project-progress">{{ project.progress }}%</span>
      </div>
      <SharedProgress :value="project.progress" :tone="projectProgressTone(project)" :label="t('projects.columns.progress')" />
    </div>
    <div class="mt-auto flex min-h-(--webvue-control-h) flex-wrap items-center gap-2">
      <SharedStatusBadge v-if="endTag" v-bind="endTag" size="sm" data-testid="project-end-date" :aria-label="`${t('projects.columns.dateEnd')}: ${endTag.label} ${endTag.title}`" />
      <span class="ms-auto flex items-center gap-1.5">
        <SharedPersonAvatar v-if="project.manager" :people="[project.manager]" />
        <ProjectMenu v-if="project.can_manage" :project="project" hide-settings />
      </span>
    </div>
  </div>
</template>
