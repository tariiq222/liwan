<script setup lang="ts">
import type { ProjectStatus } from '@liwan/contracts'
import { statusTag, type PageHeaderTag } from '@liwan/ui/app/utils/pageHeaderTag'
import { projectStatusBadge } from '@/composables/projectStatus'
import { badgeLabel } from '@liwan/ui/app/utils/statusBadge'
import ProjectPhaseStepper from '@/components/pmo/projects/ProjectPhaseStepper.vue'
import ProjectWorkspaceTabs from '@/components/pmo/projects/workspace/ProjectWorkspaceTabs.vue'
import { ApiError } from '@/composables/useApi'
import { activeGovernanceSection, activeProjectSection, projectIdFromPath } from '@/modules/pmo/projectRoutes'
import { useProject } from '@/composables/useProjects'
import { archivedTags, projectRecordBack } from '@/utils/projectNavigation'
import { formatCalendarDate } from '@liwan/ui/app/composables/calendarDate'

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
// Remember the last readable project section for re-entry.
const { me } = useMe()
const { remember } = useProjectWorkspaceMemory()
watch([() => route.fullPath, project, me, hydrated], () => {
  if (project.value?.id === projectId.value && !error.value) remember(route.path, route.query)
}, { immediate: true })
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
// The same tag pills as SharedPageHeader: state, phase, manager, schedule.
const tags = computed<PageHeaderTag[]>(() => {
  const value = project.value
  if (!value) return []
  const dates = [value.date_start, value.date_end].filter((date): date is string => Boolean(date)).map(formatDate).join(' – ')
  return [
    statusTag(projectBadge(value.status), 'project-status'),
    { label: phaseLabel.value, tone: 'info', testId: 'project-workspace-phase' },
    ...archivedTags(value, t),
    ...(value.manager ? [{ label: value.manager.name, kind: 'person' as const, icon: 'i-lucide-user' }] : []),
    ...(dates ? [{ label: dates, kind: 'schedule' as const, icon: 'i-lucide-calendar-range', testId: 'project-workspace-dates' }] : []),
  ]
})
provideFrameOwnsHeading(computed(() => showFrame.value && Boolean(project.value)))
</script>

<template>
  <div class="liwan-project-workspace flex flex-col gap-(--liwan-gap-card)">
    <!-- One compact card like SharedPageHeader (DESIGN.md §4): chip, title and tags, actions, the trail, then the tab strips. Only this card sticks (identity and tabs); the phase stepper is its own card below and scrolls away. -->
    <SharedPageContainer v-if="showFrame" width="list" class="liwan-workspace-head liwan-print-hide" data-sticky="true" data-testid="project-workspace-frame">
      <header class="flex flex-col gap-3 rounded-card bg-default px-4 py-3 ring ring-default">
        <div class="flex flex-col gap-0.5" data-testid="project-workspace-identity">
          <template v-if="project">
            <div class="flex flex-wrap items-center gap-x-3.5 gap-y-2">
              <span aria-hidden="true" class="grid size-10 shrink-0 place-items-center rounded-full bg-primary/10 text-primary"><UIcon name="i-lucide-folder-kanban" class="size-5" /></span>
              <div class="flex min-w-0 flex-1 basis-40 flex-wrap items-center gap-x-2 gap-y-1">
                <h1 class="min-w-0 text-lg/7 font-semibold text-highlighted" data-testid="project-workspace-name">{{ project.name }}</h1>
                <SharedHeaderTags :tags="tags" />
              </div>
              <UTooltip v-if="project.can_manage" :text="t('nav.projectSettings')">
                <UButton
                  class="ms-auto rounded-full"
                  color="neutral"
                  variant="ghost"
                  icon="i-lucide-settings"
                  :aria-label="t('nav.projectSettings')"
                  data-testid="project-workspace-settings"
                  :to="settingsTo"
                  :aria-current="isProjectSettings ? 'page' : undefined"
                />
              </UTooltip>
            </div>
            <nav :aria-label="t('nav.breadcrumb')" class="flex items-center gap-1.5 text-xs/5 text-muted">
              <UButton :to="backTo ?? '/projects'" :aria-label="backLabel" color="neutral" variant="link" size="xs" class="p-0 font-medium text-muted hover:text-highlighted focus-visible:ring-2 focus-visible:ring-primary" :data-testid="backTo ? 'project-workspace-back' : 'project-workspace-trail'">
                <span>{{ backLabel }}</span>
              </UButton>
              <UIcon name="i-lucide-chevron-left" aria-hidden="true" class="size-3.5 text-dimmed ltr:rotate-180" />
            </nav>
          </template>
          <USkeleton v-else-if="isLoading || !hydrated" class="h-10 w-64 max-w-full rounded-full" />
        </div>
        <!-- Tabs follow the hydrated project like the title row, so a first click is a client-side navigation. -->
        <ProjectWorkspaceTabs v-if="project" :project-id="projectId!" :active="project.active" />
        <USkeleton v-else-if="isLoading || !hydrated" class="h-(--liwan-control-h) w-full max-w-lg rounded-full" />
        <!-- Governance and planning sub-sections: a second pill strip inside the same card. -->
        <ProjectWorkspaceTabs v-if="showGovernanceTabs" level="governance" :project-id="projectId!" />
        <ProjectWorkspaceTabs v-if="showPlanningTabs && projectId" :project-id="projectId" :active="project?.active" level="planning" />
      </header>
    </SharedPageContainer>
    <SharedPageContainer v-if="showFrame && project" width="list" class="liwan-print-hide" data-testid="project-phase-card">
      <div class="rounded-card bg-default px-4 py-3 ring ring-default">
        <ProjectPhaseStepper :current="project.phase_state.current" />
      </div>
    </SharedPageContainer>
    <NuxtPage />
  </div>
</template>
