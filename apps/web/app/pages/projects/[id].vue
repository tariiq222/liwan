<script setup lang="ts">
import type { ProjectStatus } from '@nasq/contracts'
import { projectStatusBadge } from '@/composables/projectStatus'
import { badgeLabel } from '@/utils/statusBadge'
import ProjectWorkspaceTabs from '@/components/project/workspace/ProjectWorkspaceTabs.vue'
import { ApiError } from '@/composables/useApi'
import { activeGovernanceSection, activeProjectSection, projectIdFromPath } from '@/composables/nav/activeRoute'
import { useProject } from '@/composables/useProjects'
import { safeReturnTo } from '@/utils/safeReturnTo'

const route = useRoute()
const { t } = useI18n()
const projectBadge = (status: ProjectStatus | null) => { const entry = projectStatusBadge(status); return { tone: entry.tone, label: badgeLabel(entry, status, t) } }
const hydrated = useHydrated()
const projectId = computed(() => projectIdFromPath(route.path))
const { data: projectData, isLoading, error } = useProject(projectId)
// Queries may finish after server rendering but before payload dehydration.
// Keep the first client tree identical to SSR, then reveal the cached project.
const project = computed(() => hydrated.value ? projectData.value : undefined)
const notFound = computed(() => projectId.value === null || (error.value instanceof ApiError && (error.value.status === 404 || error.value.status === 403)))
const settingsTo = computed(() => `/projects/${projectId.value}/settings`)
// Settings is deliberately not one of the eight sections (activeProjectSection
// returns null for it, and the tab strip must not grow a ninth tab), but it
// is still a page of this workspace: without the frame it would lose the
// project identity and every route back to the project.
const isProjectSettings = computed(() => projectId.value !== null
  && (route.path.replace(/\/+$/, '') || '/') === settingsTo.value)
// The frame belongs to the eight sections and their records, plus settings. A
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
  ? safeReturnTo(route.query.returnTo, '/projects', ['/projects', '/tasks', '/hr', '/settings', '/account', '/search', '/notifications', '/reports'])
  : undefined)
const backLabel = computed(() => {
  const section = backTo.value?.split(/[/?#]/)[1] ?? 'projects'
  const labels: Record<string, string> = {
    projects: 'nav.projects', tasks: 'nav.tasks', hr: 'nav.organization',
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
const showGovernanceTabs = computed(() => Boolean(project.value?.active) && activeGovernanceSection(route.path) !== null)
provideProjectFrameHeading(computed(() => showFrame.value && Boolean(project.value)))
</script>

<template>
  <div class="flex flex-col gap-6">
    <SharedPageContainer v-if="showFrame" width="list" class="nasq-print-hide" data-testid="project-workspace-frame">
      <div class="flex flex-col gap-4">
        <div v-if="backTo" class="flex items-center gap-2 text-sm">
          <UButton :to="backTo" :aria-label="backLabel" color="neutral" variant="outline" class="focus-visible:ring-2 focus-visible:ring-primary" data-testid="project-workspace-back">
            <UIcon name="i-lucide-arrow-right" aria-hidden="true" class="size-4.5 ltr:rotate-180" />{{ backLabel }}
          </UButton>
        </div>
        <div class="flex min-h-9 flex-wrap items-start justify-between gap-3" data-testid="project-workspace-identity">
          <div v-if="project" class="min-w-0">
            <h1 class="truncate text-xl font-semibold text-highlighted" data-testid="project-workspace-name">{{ project.name }}</h1>
            <p class="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted">
              <SharedStatusBadge v-bind="projectBadge(project.status)" data-testid="project-status" />
              <span v-if="project.manager" class="inline-flex items-center gap-1.5">
                <UIcon name="i-lucide-user-round" class="size-4" aria-hidden="true" />
                <span class="sr-only">{{ t('projects.columns.manager') }}: </span>{{ project.manager.name }}
              </span>
            </p>
          </div>
          <USkeleton v-else-if="isLoading || !hydrated" class="h-9 w-1/3" />
          <UButton
            v-if="project?.can_manage"
            square
            color="neutral"
            variant="outline"
            icon="i-lucide-settings"
            class="ms-auto"
            data-testid="project-workspace-settings"
            :to="settingsTo"
            :aria-label="t('nav.projectSettings')"
            :title="t('nav.projectSettings')"
            :aria-current="isProjectSettings ? 'page' : undefined"
          />
        </div>
        <!-- Tabs follow the hydrated project like the title row, so a first click is a client-side navigation. -->
        <ProjectWorkspaceTabs v-if="project" :project-id="projectId!" :active="project.active" />
        <ProjectWorkspaceTabs v-if="showGovernanceTabs" level="governance" :project-id="projectId!" class="-mt-4" />
        <USkeleton v-else-if="isLoading || !hydrated" class="h-8 w-2/3" />
      </div>
    </SharedPageContainer>
    <NuxtPage />
  </div>
</template>
