<script setup lang="ts">
import type { Project } from '@liwan/contracts'
import type { RouteLocationRaw } from 'vue-router'
import RecordNumber from '@liwan/ui/app/components/shared/data/RecordNumber.vue'
import { PHASE_LABEL_KEY } from '@/composables/projectPhase'
import { projectEndTagView, projectProgressTone, projectStatusPill } from './projectHealth'
import ProjectMenu from './ProjectMenu.vue'

// One project as a body: number, phase and status, then name, progress with the task counts, then manager and end date.
// It is the inside of a card (ProjectCards) and of a phone row of the table (ProjectTable's #mobile-row), so both show
// the same information. Three short lines keep the card compact; the caller owns the surface around it.
type ProjectListItem = Project & { manager?: { id: number; name: string } | null; date_end?: string | null }
const props = defineProps<{ project: ProjectListItem; toFor: (project: ProjectListItem) => RouteLocationRaw }>()
const { t } = useI18n()
const endTag = computed(() => projectEndTagView(props.project, t))
const statusPill = computed(() => projectStatusPill(props.project.status, t))
// A charter waiting for approval is the one charter state worth marking on the list; draft and approved stay silent.
const awaitingCharter = computed(() => props.project.charter_state === 'submitted')
const taskLabel = computed(() => t('projects.progressOf', { closed: props.project.closed_task_count, total: props.project.task_count }, props.project.task_count))
</script>

<template>
  <div class="flex h-full min-w-0 flex-col gap-2">
    <div class="flex min-w-0 items-center gap-2">
      <SharedStatusBadge v-bind="statusPill" size="sm" data-testid="project-status" class="shrink-0" />
      <span class="min-w-0 truncate text-xs text-muted" :title="`${t('projects.phase.title')}: ${t(PHASE_LABEL_KEY[project.phase])}`">{{ t(PHASE_LABEL_KEY[project.phase]) }}</span>
      <SharedStatusBadge v-if="awaitingCharter" tone="info" size="sm" icon="i-lucide-file-clock" :label="t('projects.charter.state.submitted')" class="shrink-0" />
      <RecordNumber :value="project.id" class="ms-auto shrink-0" />
      <ProjectMenu v-if="project.can_manage" :project="project" hide-settings class="-me-1 -my-1 shrink-0" />
    </div>
    <h2 :id="`project-card-${project.id}`" class="min-w-0 truncate text-sm font-semibold text-highlighted" :title="project.name">
      <NuxtLink :to="toFor(project)" class="rounded hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">{{ project.name }}</NuxtLink>
    </h2>
    <div class="flex min-w-0 items-center gap-2">
      <span class="shrink-0 text-sm font-semibold tabular-nums text-highlighted" data-testid="project-progress" dir="ltr">{{ project.progress }}%</span>
      <SharedProgress class="min-w-0 flex-1" :value="project.progress" :tone="projectProgressTone(project)" :label="t('projects.columns.progress')" />
      <span class="shrink-0 text-xs tabular-nums text-muted" dir="ltr" :title="taskLabel" :aria-label="taskLabel">{{ project.closed_task_count }}/{{ project.task_count }}</span>
    </div>
    <div class="mt-auto flex min-w-0 items-center gap-2 text-xs text-muted">
      <SharedPersonAvatar v-if="project.manager" :people="[project.manager]" />
      <span class="min-w-0 truncate"><span class="sr-only">{{ t('projects.columns.manager') }}: </span>{{ project.manager?.name ?? '—' }}</span>
      <SharedStatusBadge v-if="endTag" v-bind="endTag" size="sm" class="ms-auto shrink-0" data-testid="project-end-date" :aria-label="`${t('projects.columns.dateEnd')}: ${endTag.label} ${endTag.title}`" />
      <span v-else class="ms-auto shrink-0" :aria-label="t('projects.noEndDate')">—</span>
    </div>
  </div>
</template>
