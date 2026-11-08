<script setup lang="ts">
import { projectSectionAvailable } from '@/utils/projectTools'
import { projectActionPage } from '@/utils/projectHeaderAction'
import { isProjectRecordPath } from '@/utils/projectRecordRoute'
import type { ProjectStatus } from '@liwan/contracts'
import { statusTag, type PageHeaderTag } from '@liwan/ui/app/utils/pageHeaderTag'
import { projectStatusBadge } from '@/composables/projectStatus'
import { badgeLabel } from '@liwan/ui/app/utils/statusBadge'
import ProjectNotFoundState from '@/components/pmo/projects/ProjectNotFoundState.vue'
import ProjectPhaseStepper from '@/components/pmo/projects/ProjectPhaseStepper.vue'
import ProjectWorkspaceActions from '@/components/pmo/projects/workspace/ProjectWorkspaceActions.vue'
import ProjectWorkspaceTabs from '@/components/pmo/projects/workspace/ProjectWorkspaceTabs.vue'
import { ApiError } from '@/composables/useApi'
import { activeGovernanceSection, activePlanningSection, activeProjectSection, projectIdFromPath } from '@/modules/pmo/projectRoutes'
import { useProject } from '@/composables/useProjects'
import { useProjectArchive } from '@/composables/useProjectArchive'
import { archivedTags, projectRecordBack } from '@/utils/projectNavigation'
import { formatCalendarDate } from '@liwan/ui/app/composables/calendarDate'

// Sections share the project frame; standalone records keep their own entrance.
definePageMeta({
  pageEntranceGroup: (path: string) => {
    const id = projectIdFromPath(path)
    return id !== null && !isProjectRecordPath(path) ? `project-workspace:${id}` : undefined
  },
})

const sourcePaths = useRecordListPaths(['/projects', '/projects/dashboard'])
const route = useRoute()
const router = useRouter()
const { t } = useI18n()
const projectBadge = (status: ProjectStatus | null) => { const entry = projectStatusBadge(status); return { tone: entry.tone, label: badgeLabel(entry, status, t) } }
const hydrated = useHydrated()
const formatDate = (value: string) => formatCalendarDate(value) || value
const projectId = computed(() => projectIdFromPath(route.path))
const { data: projectData, isLoading, error, refetch } = useProject(projectId)
// Queries may finish after server rendering but before payload dehydration.
// Keep the first client tree identical to SSR, then reveal the cached project.
const project = computed(() => hydrated.value ? projectData.value : undefined)
// Remember the last readable project section for re-entry.
const { me } = useMe()
const { remember } = useProjectWorkspaceMemory()
watch([() => route.fullPath, project, me, hydrated], () => {
  if (project.value?.id === projectId.value && !error.value) remember(route.path, route.query)
}, { immediate: true })
// The sidebar lists the projects opened last.
const recentProjects = useRecentRecords('project')
watch([() => project.value?.id, () => project.value?.name, me], ([id, name]) => {
  if (id !== undefined && name !== undefined && id === projectId.value && !error.value) recentProjects.remember({ id, name })
}, { immediate: true })
const notFound = computed(() => projectId.value === null || (error.value instanceof ApiError && (error.value.status === 404 || error.value.status === 403)))
const settingsPath = computed(() => `/projects/${projectId.value}/settings`)
// Settings is deliberately not one of the project sections (activeProjectSection
// returns null for it, and the tab strip must not grow an extra tab), but it
// is still a page of this workspace: without the frame it would lose the
// project identity and every route back to the project.
const isProjectSettings = computed(() => projectId.value !== null
  && (route.path.replace(/\/+$/, '') || '/') === settingsPath.value)
// The frame belongs to the project sections and their records, plus settings. A
// failed load with nothing cached has no identity to show; the parent owns
// its loading/error state before a gated child may mount. `projectData` rather
// than `project` here: gating on
// the hydration-delayed value would make the first client render drop a frame
// the server had already emitted.
// A record (a task, milestone or meeting of the project) draws its own trail and header, so the frame steps aside.
const showFrame = computed(() => !notFound.value
  && !(error.value && !projectData.value)
  && !isProjectRecordPath(route.path)
  && (activeProjectSection(route.path) !== null || isProjectSettings.value))
// Only the summary borrows the frame's Back control; child records and forms
// keep their own header and Escape target. Keep the same safe origins as the
// summary's not-found route.
const backTo = computed(() => showFrame.value && projectActionPage(route.path) === 'summary'
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
const showPlanningTabs = computed(() => project.value?.tools.planning.enabled && activePlanningSection(route.path) !== null)
const showGovernanceTabs = computed(() => Boolean(project.value?.active && project.value.tools.governance.enabled) && activeGovernanceSection(route.path) !== null)
// A task record owns its read permission; its parent project may be unreadable.
const isIndependentTaskRecord = computed(() => {
  const match = route.path.match(/^\/projects\/\d+\/tasks\/(\d+)\/?$/)
  return projectId.value !== null && !!match && Number.isInteger(Number(match[1])) && Number(match[1]) > 0
})
const routeAllowed = computed(() => isIndependentTaskRecord.value || (!!projectData.value && !notFound.value && projectSectionAvailable(route.path.split('/')[3] ?? 'summary', projectData.value.tools)))
const activatedPaths = reactive(new Set<string>())
watch([() => route.path, routeAllowed], ([path, allowed]) => { if (allowed) activatedPaths.add(path) }, {immediate:true})
// One status badge after the title (the archived badge joins it on an archived project); the owner and the dates are a muted line under it.
const tags = computed<PageHeaderTag[]>(() => {
  const value = project.value
  if (!value) return []
  return [statusTag(projectBadge(value.status), 'project-status'), ...archivedTags(value, t)]
})
const dates = computed(() => [project.value?.date_start, project.value?.date_end].filter((date): date is string => Boolean(date)).map(formatDate).join(' – '))
// The header draws the page's primary action and the KPI toggle on the pages that have them; said by the route, so the page below never flashes its own.
provideFrameOwnsActions(computed(() => showFrame.value && projectActionPage(route.path) !== null))
const confirmingArchive = ref(false)
const { archive, pending: archivePending } = useProjectArchive(project)
async function archiveProject() {
  if (await archive()) confirmingArchive.value = false
}
provideFrameOwnsHeading(computed(() => showFrame.value && Boolean(project.value)))
</script>

<template>
  <div class="liwan-project-workspace flex flex-col gap-(--liwan-gap-card)">
    <!-- The open header (DESIGN.md §4): the trail, then one row with the 64px app tile, the title with its one status badge and the muted owner and dates under it, and the primary action and ⋯ menu at the inline end; the underline tabs follow over the header's 1px divider. The sub-strips and the phase stepper follow below it. -->
    <SharedPageContainer v-if="showFrame" class="liwan-print-hide" data-testid="project-workspace-frame">
      <header class="flex min-w-0 flex-col gap-3 border-b border-default">
        <div class="flex min-w-0 flex-col gap-3" data-testid="project-workspace-identity">
          <template v-if="project">
            <nav :aria-label="t('nav.breadcrumb')" class="flex items-center gap-1.5 text-[13px]/5 text-muted">
              <UButton :to="backTo ?? '/projects'" :aria-label="backLabel" color="neutral" variant="link" size="xs" class="p-0 font-medium text-muted hover:text-highlighted focus-visible:ring-2 focus-visible:ring-primary" :data-testid="backTo ? 'project-workspace-back' : 'project-workspace-trail'">
                <span>{{ backLabel }}</span>
              </UButton>
              <UIcon name="i-lucide-chevron-left" aria-hidden="true" class="size-3.5 text-dimmed ltr:rotate-180" />
            </nav>
            <div class="flex flex-wrap items-center gap-x-5 gap-y-3">
              <span aria-hidden="true" class="liwan-app-tile liwan-app-tile-lg grid shrink-0 place-items-center" data-app="projects"><UIcon name="i-lucide-folder-kanban" class="size-[46%]!" /></span>
              <div class="min-w-0 flex-1 basis-60">
                <div class="flex min-w-0 items-baseline gap-x-3">
                  <h1 class="min-w-0 font-display text-(length:--liwan-fs-display)/[1.3] font-bold tracking-[-0.01em] text-highlighted" data-testid="project-workspace-name">{{ project.name }}</h1>
                  <div class="shrink-0"><SharedHeaderTags :tags="tags" /></div>
                </div>
                <p v-if="project.manager || dates" class="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px]/5 text-muted" data-testid="project-workspace-meta">
                  <span v-if="project.manager" class="inline-flex items-center gap-1.5" data-testid="project-workspace-manager"><UIcon name="i-lucide-user" aria-hidden="true" class="size-3.5 shrink-0" />{{ project.manager.name }}</span>
                  <span v-if="dates" class="inline-flex items-center gap-1.5" data-testid="project-workspace-dates"><UIcon name="i-lucide-calendar-range" aria-hidden="true" class="size-3.5 shrink-0" /><bdi>{{ dates }}</bdi></span>
                </p>
              </div>
              <ProjectWorkspaceActions :project="project" @archive="confirmingArchive = true" />
            </div>
          </template>
          <USkeleton v-else-if="isLoading || !hydrated" class="h-16 w-72 max-w-full rounded-control" />
        </div>
        <!-- Tabs follow the hydrated project like the title row, so a first click is a client-side navigation. -->
        <ProjectWorkspaceTabs v-if="project" :project-id="projectId!" :active="project.active" />
        <USkeleton v-else-if="isLoading || !hydrated" class="h-(--liwan-control-h) w-full max-w-lg rounded-control" />
      </header>
      <SharedInlineConfirm
        v-if="project?.active && confirmingArchive"
        class="mt-3"
        data-testid="project-archive-confirm"
        :title="t('projects.archiveConfirmTitle')"
        :description="t('projects.archiveConfirmText')"
        :confirm-label="t('projects.menu.archive')"
        :pending="archivePending"
        @cancel="confirmingArchive = false"
        @confirm="archiveProject"
      />
      <!-- Finance, governance and the milestones and baselines: a pill strip under the header's divider. -->
      <div class="mt-3 flex min-w-0 flex-col gap-3 empty:hidden">
        <ProjectWorkspaceTabs v-if="project?.tools.finance.enabled && activeProjectSection(route.path) === 'finance'" level="finance" :project-id="project.id" />
        <ProjectWorkspaceTabs v-if="showGovernanceTabs" level="governance" :project-id="projectId!" />
        <ProjectWorkspaceTabs v-if="showPlanningTabs && projectId" :project-id="projectId" :active="project?.active" level="planning" />
      </div>
    </SharedPageContainer>
    <SharedPageContainer v-if="showFrame && project?.phase_state && activeProjectSection(route.path) === 'governance' && routeAllowed" class="liwan-print-hide" data-testid="project-phase-card">
      <div class="rounded-card bg-default px-4 py-3 ring ring-default">
        <ProjectPhaseStepper :current="project.phase_state.current" />
      </div>
    </SharedPageContainer>
    <ProjectNotFoundState v-if="notFound && !isIndependentTaskRecord" />
    <SharedPageContainer v-else-if="!projectData && !isIndependentTaskRecord">
      <SharedPageState :loading="!error && (isLoading || !hydrated)" :error="error" @retry="refetch()" />
    </SharedPageContainer>
    <SharedPageContainer v-else-if="project && !routeAllowed">
      <UAlert color="neutral" variant="subtle" :title="t('projects.tools.unavailable')" :description="t('projects.tools.policyChanged')" />
      <UButton color="neutral" variant="outline" :to="`/projects/${project.id}`" :label="t('nav.projectSummary')" />
    </SharedPageContainer>
    <NuxtPage v-if="routeAllowed || activatedPaths.has(route.path)" v-show="routeAllowed" />
  </div>
</template>
