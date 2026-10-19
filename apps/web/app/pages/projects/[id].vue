<script setup lang="ts">
import type { ProjectStatus } from '@webvue/contracts'
import { projectStatusBadge } from '@/composables/projectStatus'
import { badgeLabel } from '@webvue/ui/app/utils/statusBadge'
import ProjectPhaseStepper from '@/components/pmo/projects/ProjectPhaseStepper.vue'
import ProjectWorkspaceTabs from '@/components/pmo/projects/workspace/ProjectWorkspaceTabs.vue'
import { ApiError } from '@/composables/useApi'
import { activeGovernanceSection, activeProjectSection, projectIdFromPath } from '@/composables/nav/activeRoute'
import { useProject } from '@/composables/useProjects'
import { projectRecordBack } from '@/utils/projectNavigation'
import { formatCalendarDate } from '@webvue/ui/app/composables/calendarDate'

const sourcePaths = useRecordListPaths(['/projects', '/projects/dashboard'])
const route = useRoute()
const router = useRouter()
const { t, locale } = useI18n()
const projectBadge = (status: ProjectStatus | null) => { const entry = projectStatusBadge(status); return { tone: entry.tone, label: badgeLabel(entry, status, t) } }
const hydrated = useHydrated()
const formatDate = (value: string) => formatCalendarDate(value, locale.value) || value
const projectId = computed(() => projectIdFromPath(route.path))
const { data: projectData, isLoading, error } = useProject(projectId)
// Queries may finish after server rendering but before payload dehydration.
// Keep the first client tree identical to SSR, then reveal the cached project.
const project = computed(() => hydrated.value ? projectData.value : undefined)
const notFound = computed(() => projectId.value === null || (error.value instanceof ApiError && (error.value.status === 404 || error.value.status === 403)))
const settingsTo = computed(() => `/projects/${projectId.value}/settings`)
// Settings is deliberately not one of the project sections (activeProjectSection
// returns null for it, and the tab strip must not grow an extra tab), but it
// is still a page of this workspace: without the frame it would lose the
// project identity and every route back to the project.
const isProjectSettings = computed(() => projectId.value !== null
  && (route.path.replace(/\/+$/, '') || '/') === settingsTo.value)
// The frame belongs to the project sections and their records, plus settings. A
// failed load with nothing cached has no identity to show, so the child page's
// error state stands alone. `projectData` rather than `project` here: gating on
// the hydration-delayed value would make the first client render drop a frame
// the server had already emitted.
const showFrame = computed(() => !notFound.value
  && !(error.value && !projectData.value)
  && (activeProjectSection(route.path) !== null || isProjectSettings.value))
// Only the summary borrows the frame's Back control; child records and forms
// keep their own header and Escape target. Keep the same safe origins as the
// summary's not-found route.
const backTo = computed(() => showFrame.value && activeProjectSection(route.path) === 'summary'
  ? router.resolve(projectRecordBack(route.query, projectId.value, sourcePaths.value, route.hash)).fullPath
  : undefined)
const backLabel = computed(() => {
  const section = backTo.value?.split(/[/?#]/)[1] ?? 'projects'
  const labels: Record<string, string> = {
    '': 'nav.home', 'my-tasks': 'nav.myTasks', projects: 'nav.projects', tasks: 'nav.tasks', hr: 'nav.hr',
    settings: 'nav.settings', account: 'nav.account', search: 'app.search',
    notifications: 'notifications.title', reports: 'nav.reports',
  }
  return t(labels[section] ?? 'nav.projects')
})
useEscapeBack(backTo)
// The project name below is the page heading whenever it is actually on screen;
// SharedPageHeader inside a child page reads this and demotes its own heading a
// level, so a project page never renders two top-level headings and never none.
// Governance is the one section with sub-sections; they get a second strip
// under the main one on every governance page, records included. An archived
// project has no governance tab, so it gets no sub-strip either.
const showPlanningTabs = computed(() => activeProjectSection(route.path) === 'planning')
const showGovernanceTabs = computed(() => Boolean(project.value?.active) && activeGovernanceSection(route.path) !== null)
const phaseLabel = computed(() => project.value ? t(`projects.phase.steps.${project.value.phase_state.current}`) : '')
provideFrameOwnsHeading(computed(() => showFrame.value && Boolean(project.value)))
</script>

<template>
  <div class="flex flex-col gap-(--webvue-gap-card)">
    <!-- Layer 1: a full-bleed white band (project identity, meta line, the phase stepper and the main tabs). -->
    <div v-if="showFrame" class="webvue-page-band webvue-print-hide border-b border-default bg-default" data-sticky="true" data-testid="project-workspace-frame">
      <SharedPageContainer width="list">
        <div class="flex flex-col gap-(--webvue-gap-card)">
          <div class="flex flex-col gap-2" data-testid="project-workspace-identity">
            <template v-if="project">
              <!-- Title row: the name, then the two pills (status, phase), and the settings action at the end. -->
              <div class="flex flex-wrap items-center gap-x-3 gap-y-2">
                <h1 class="min-w-0 truncate text-xl font-semibold text-highlighted" data-testid="project-workspace-name">{{ project.name }}</h1>
                <SharedStatusBadge v-bind="projectBadge(project.status)" data-testid="project-status" />
                <UBadge color="primary" variant="subtle" class="max-sm:hidden" data-testid="project-workspace-phase">{{ phaseLabel }}</UBadge>
                <UTooltip v-if="project.can_manage" :text="t('nav.projectSettings')">
                  <UButton
                    class="ms-auto"
                    color="neutral"
                    variant="outline"
                    icon="i-lucide-settings"
                    :aria-label="t('nav.projectSettings')"
                    data-testid="project-workspace-settings"
                    :to="settingsTo"
                    :aria-current="isProjectSettings ? 'page' : undefined"
                  />
                </UTooltip>
                <nav v-if="backTo" :aria-label="t('nav.breadcrumb')" class="flex w-full flex-wrap items-center gap-1.5 text-xs text-muted">
                  <UButton :to="backTo" :aria-label="backLabel" color="neutral" variant="link" size="xs" class="p-0 font-medium text-muted hover:text-highlighted focus-visible:ring-2 focus-visible:ring-primary" data-testid="project-workspace-back">
                    <span>{{ backLabel }}</span>
                  </UButton>
                </nav>
              </div>
              <p class="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted" data-testid="project-workspace-meta">
                <span v-if="project.manager" class="inline-flex items-center gap-2">
                  <SharedPersonAvatar :people="[project.manager]" />
                  <span class="sr-only">{{ t('projects.columns.manager') }}: </span>{{ project.manager.name }}
                </span>
                <span v-if="project.date_start || project.date_end" class="inline-flex items-center gap-1.5" data-testid="project-workspace-dates">
                  <UIcon name="i-lucide-calendar-range" class="size-4" aria-hidden="true" />
                  <span class="sr-only">{{ t('projects.charter.fields.date_start') }}: </span>
                  <span v-if="project.date_start">{{ formatDate(project.date_start) }}</span>
                  <template v-if="project.date_start && project.date_end"><UIcon name="i-lucide-arrow-left" class="size-3.5 ltr:rotate-180" aria-hidden="true" /><span class="sr-only">{{ t('projects.charter.fields.date_end') }}: </span></template>
                  <span v-if="project.date_end">{{ formatDate(project.date_end) }}</span>
                </span>
              </p>
              <ProjectPhaseStepper :current="project.phase_state.current" />
            </template>
            <USkeleton v-else-if="isLoading || !hydrated" class="h-(--webvue-control-h) w-64 max-w-full" />
          </div>
          <!-- Tabs follow the hydrated project like the title row, so a first click is a client-side navigation. -->
          <ProjectWorkspaceTabs v-if="project" :project-id="projectId!" :active="project.active" />
          <USkeleton v-else-if="isLoading || !hydrated" class="h-(--webvue-control-h) w-full max-w-lg" />
        </div>
      </SharedPageContainer>
    </div>
    <!-- Governance and planning sub-sections: a second strip, same look as the main tabs, on the canvas just under the band. -->
    <SharedPageContainer v-if="showFrame && showGovernanceTabs" width="list" class="webvue-print-hide">
      <ProjectWorkspaceTabs level="governance" :project-id="projectId!" />
    </SharedPageContainer>
    <SharedPageContainer v-if="showFrame && showPlanningTabs" width="list" class="webvue-print-hide">
      <ProjectWorkspaceTabs v-if="projectId" :project-id="projectId" :active="project?.active" level="planning" />
    </SharedPageContainer>
    <NuxtPage />
  </div>
</template>
