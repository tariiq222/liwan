<script setup lang="ts">
import type { LocationQueryRaw, RouteLocationRaw } from 'vue-router'
import { inject } from 'vue'
import MilestoneTable from '@/components/project/MilestoneTable.vue'
import ProjectHeader from '@/components/project/ProjectHeader.vue'
import ProjectOverview from '@/components/project/ProjectOverview.vue'
import ProjectStatusBadge from '@/components/project/ProjectStatusBadge.vue'
import ProjectWorkspaceTabs from '@/components/project/workspace/ProjectWorkspaceTabs.vue'
import TaskBoard from '@/components/task/TaskBoard.vue'
import TaskTable from '@/components/task/TaskTable.vue'
import TaskToolbar from '@/components/task/TaskToolbar.vue'
import { ApiError } from '@/composables/useApi'
import { projectTaskParams, projectTaskQuery } from '@/composables/projectTaskParams'
import { projectContextId, projectContextLinks } from '@/composables/useNav'
import { projectSectionRoot } from '@/composables/useShellNavigation'
import { useProject } from '@/composables/useProjects'
import type { TaskListParams } from '@/composables/useTasks'
import { isProjectOverlayRoute } from '@/utils/projectOverlayRoute'
import { safeReturnTo, returnToQuery } from '@/utils/safeReturnTo'

const route = useRoute()
const router = useRouter()
const { t } = useI18n()
const { can } = useAccess()
const { me } = useMe()
const hydrated = useHydrated()
const isProjectOverlay = inject<boolean>(Symbol.for('nasq.project.overlay'), false)
const normalizedPath = computed(() => route.path.replace(/\/+$/, '') || '/')
const isBaseRoute = computed(() => normalizedPath.value === `/projects/${route.params.id}`)

const projectId = computed(() => {
  const n = Number(route.params.id)
  return Number.isInteger(n) && n > 0 ? n : null
})
const { data: projectData, isLoading, error, refetch } = useProject(projectId)
// Queries may finish after server rendering but before payload dehydration.
// Keep the first client tree identical to SSR, then reveal the cached project.
const project = computed(() => hydrated.value ? projectData.value : undefined)
const notFound = computed(() => projectId.value === null || (error.value instanceof ApiError && (error.value.status === 404 || error.value.status === 403)))
// The workspace frame (title row + group tabs) belongs to section roots only:
// never inside the route-backed side sheet nor on full-page detail/create/edit routes.
const showWorkspaceFrame = computed(() => !isProjectOverlay
  && projectId.value !== null
  && !notFound.value
  && !(error.value && !project.value)
  && !isProjectOverlayRoute({ path: route.path, query: route.query })
  && projectSectionRoot(route.path, route.query) !== null)
const isSettingsSection = computed(() => projectContextId(route.path, route.query) === 'settings')
// Same query the old sidebar settings link carried (remembered task context +
// list origin) plus a precise return to the current section.
const settingsTo = computed<RouteLocationRaw>(() => {
  const link = projectId.value
    ? projectContextLinks(projectId.value, me.value, project.value?.active === true, true, route.query, isBaseRoute.value).find(item => item.id === 'settings')
    : undefined
  const contextQuery = link && typeof link.to === 'object' && 'query' in link.to ? link.to.query ?? {} : {}
  return { path: `/projects/${projectId.value}/settings`, query: { ...contextQuery, ...returnToQuery(route.fullPath) } }
})

type PlanningView = 'list' | 'board' | 'milestones'
const workspaceTab = computed(() => projectContextId(route.path, route.query, true))
const planningView = computed<PlanningView | null>(() => {
  const tab = workspaceTab.value
  if (tab === 'milestones') return 'milestones'
  if (tab === 'tasks') return route.query.tab === 'board' || route.query.view === 'board' ? 'board' : 'list'
  return null
})
const isSummary = computed(() => workspaceTab.value === 'summary')
const taskView = computed<'table' | 'board'>(() => planningView.value === 'board' ? 'board' : 'table')

const params = computed<TaskListParams>(() => projectTaskParams(projectId.value!, route.query))
function onParams(value: TaskListParams) {
  router.replace({ query: { ...route.query, ...projectTaskQuery(value) } })
}

function taskRouteQuery() {
  const query: LocationQueryRaw = { ...route.query, ...returnToQuery(route.fullPath) }
  query.tab = planningView.value === 'board' ? 'board' : 'tasks'
  query.view = planningView.value === 'board' ? 'board' : undefined
  return query
}

function openTask(taskId: number) {
  router.push({ path: `/projects/${projectId.value}/tasks/${taskId}`, query: taskRouteQuery() })
}

const stageSource = computed(() => ({ kind: 'project' as const, stages: project.value?.stages ?? [] }))
const projectReturnTo = computed(() => safeReturnTo(route.query.returnTo, '/projects', ['/projects', '/tasks', '/hr', '/settings', '/account', '/search', '/notifications', '/reports']))

function planningLink(view: PlanningView) {
  const query: LocationQueryRaw = { ...route.query }
  delete query.view
  query.tab = view === 'list' ? 'tasks' : view
  return { path: `/projects/${projectId.value}`, query }
}

function openTaskCreate() {
  router.push({ path: `/projects/${projectId.value}/tasks/new`, query: taskRouteQuery() })
}
function onWorkspaceCreate() {
  const id = projectId.value
  if (!id) return
  const query = returnToQuery(route.fullPath)
  if (isSummary.value) router.push({ path: `/projects/${id}/updates/new`, query })
  else if (planningView.value === 'milestones') router.push({ path: `/projects/${id}/milestones/new`, query })
  else openTaskCreate()
}
function openSettings() {
  router.push({ path: `/projects/${projectId.value}/settings`, query: returnToQuery(route.fullPath) })
}
function openCharterEdit() {
  router.push({ path: `/projects/${projectId.value}/charter`, query: { edit: '1' } })
}
function onArchived() {
  router.push('/projects')
}
function onUnarchived() {}

const workspaceCreateLabel = computed(() => {
  if (isSummary.value) return t('projects.updates.add')
  if (planningView.value === 'milestones') return t('projects.milestones.new')
  return t('tasks.new')
})
const workspaceCanCreate = computed(() => {
  if (isSummary.value || planningView.value === 'milestones') return project.value?.can_manage === true
  return can('pmo.tasks.create')
})
</script>

<template>
  <SharedPageContainer v-if="showWorkspaceFrame" width="list" data-testid="project-workspace-frame">
    <div class="flex flex-col gap-4">
      <div class="flex flex-wrap items-center justify-between gap-3" data-testid="project-workspace-identity">
        <div v-if="project" class="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
          <p class="min-w-0 truncate text-lg font-semibold text-highlighted" data-testid="project-workspace-name">{{ project.name }}</p>
          <ProjectStatusBadge :status="project.status" />
          <span v-if="project.manager" class="inline-flex items-center gap-1.5 text-sm text-muted">
            <UIcon name="i-lucide-user-round" class="size-4" aria-hidden="true" />
            <span class="sr-only">{{ t('projects.columns.manager') }}: </span>{{ project.manager.name }}
          </span>
        </div>
        <USkeleton v-else-if="isLoading || !hydrated" class="h-7 w-1/3" />
        <UButton
          v-if="project?.can_manage"
          square
          icon="i-lucide-settings"
          class="ms-auto"
          data-testid="project-workspace-settings"
          :to="settingsTo"
          :aria-label="t('nav.projectSettings')"
          :title="t('nav.projectSettings')"
          :aria-current="isSettingsSection ? 'page' : undefined"
        />
      </div>
      <!-- Tabs follow the hydrated project like the title row, so a first click is a client-side navigation. -->
      <ProjectWorkspaceTabs v-if="project" :project-id="projectId!" :active="project.active" :can-manage="project.can_manage" />
      <USkeleton v-else-if="isLoading || !hydrated" class="h-8 w-2/3" />
    </div>
  </SharedPageContainer>
  <SharedPageContainer v-if="isBaseRoute" width="list">
    <div v-if="notFound" class="flex flex-col items-start gap-3">
      <p class="text-muted">{{ t('projects.notFound') }}</p>
      <UButton type="button" color="neutral" variant="outline" size="sm" @click="router.push(projectReturnTo)">{{ t('projects.backToProjects') }}</UButton>
    </div>

    <SharedPageState v-else-if="error" :error="error" @retry="refetch" />

    <template v-else>
      <ProjectHeader
        v-if="project && !isProjectOverlay"
        :project="project"
        :title="t(isSummary ? 'nav.projectSummary' : planningView === 'milestones' ? 'projects.tabs.milestones' : 'nav.projectTasks')"
        :can-create="workspaceCanCreate"
        :show-create="true"
        :create-label="workspaceCreateLabel"
        @create="onWorkspaceCreate"
        @edit="openCharterEdit"
        @settings="openSettings"
        @archived="onArchived"
        @unarchived="onUnarchived"
      />
      <USkeleton v-else-if="(isLoading || !hydrated) && !isProjectOverlay" class="h-9 w-1/2" />


      <ProjectOverview v-if="project && isSummary" :project="project" />

      <section v-if="isBaseRoute && project && (planningView === 'list' || planningView === 'board')" class="min-w-0 space-y-4" :aria-label="t('projects.tabs.tasks')">
        <TaskToolbar :model-value="params" embedded collapsible hide-project-filter @update:model-value="onParams">
          <template #view>
            <nav class="nasq-ui-segment" :aria-label="t('projects.planning.views')">
              <UButton color="neutral" size="sm" icon="i-lucide-list" :variant="planningView === 'list' ? 'soft' : 'ghost'" :to="planningLink('list')" :aria-current="planningView === 'list' ? 'page' : undefined">{{ t('projects.tabs.list') }}</UButton>
              <UButton color="neutral" size="sm" icon="i-lucide-layout-grid" :variant="planningView === 'board' ? 'soft' : 'ghost'" :to="planningLink('board')" :aria-current="planningView === 'board' ? 'page' : undefined">{{ t('projects.tabs.board') }}</UButton>
            </nav>
          </template>
        </TaskToolbar>
        <div class="nasq-ui-record-surface">
          <TaskTable v-if="taskView === 'table'" :params="params" variant="project" embedded @open="openTask" @create="openTaskCreate" />
          <TaskBoard v-else :params="params" :stage-source="stageSource" embedded @open="openTask" />
        </div>
        <div class="flex justify-end">
          <NuxtLink :to="{ path: '/archived-tasks', query: { project_id: project.id, ...returnToQuery(route.fullPath) } }" class="text-sm text-muted hover:underline">{{ t('taskLifecycle.archivedTasks') }}</NuxtLink>
        </div>
      </section>

      <div v-if="isBaseRoute && project && planningView === 'milestones'">
        <MilestoneTable :project-id="project.id" :can-manage="project.can_manage" embedded />
        <div class="mt-4 flex justify-end">
          <UButton :to="planningLink('list')">{{ t('projects.milestones.continueToTasks') }}</UButton>
        </div>
      </div>
    </template>
  </SharedPageContainer>
  <NuxtPage />
</template>
