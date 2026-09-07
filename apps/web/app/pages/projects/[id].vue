<script setup lang="ts">
import type { LocationQueryRaw } from 'vue-router'
import MilestoneTable from '@/components/project/MilestoneTable.vue'
import ProjectHeader from '@/components/project/ProjectHeader.vue'
import ProjectMetadataRail from '@/components/project/ProjectMetadataRail.vue'
import ProjectOverview from '@/components/project/ProjectOverview.vue'
import ProjectOverviewTasks from '@/components/project/ProjectOverviewTasks.vue'
import ProjectProgress from '@/components/project/ProjectProgress.vue'
import ProjectStatusBadge from '@/components/project/ProjectStatusBadge.vue'
import ProjectStatusSelect from '@/components/project/ProjectStatusSelect.vue'
import ProjectUpdateList from '@/components/project/ProjectUpdateList.vue'
import TaskBoard from '@/components/task/TaskBoard.vue'
import TaskTable from '@/components/task/TaskTable.vue'
import TaskToolbar from '@/components/task/TaskToolbar.vue'
import { ApiError } from '@/composables/useApi'
import { formatCalendarDate } from '@/composables/calendarDate'
import { projectTaskParams, projectTaskQuery } from '@/composables/projectTaskParams'
import { useProject } from '@/composables/useProjects'
import type { TaskListParams } from '@/composables/useTasks'
import { safeReturnTo, returnToQuery } from '@/utils/safeReturnTo'

const route = useRoute()
const router = useRouter()
const { t, locale } = useI18n()
const hydrated = useHydrated()
const normalizedPath = computed(() => route.path.replace(/\/+$/, '') || '/')
const isBaseRoute = computed(() => normalizedPath.value === `/projects/${route.params.id}`)
const workspaceSection = computed(() => {
  if (route.query.tab === 'list' || route.query.tab === 'board') return 'tasks'
  if (isProjectTab(route.query.tab)) return route.query.tab
  return 'overview'
})

const projectId = computed(() => {
  const n = Number(route.params.id)
  return Number.isInteger(n) && n > 0 ? n : null
})
const { data: project, isLoading, error, refetch } = useProject(projectId)
const notFound = computed(() => projectId.value === null || (error.value instanceof ApiError && (error.value.status === 404 || error.value.status === 403)))

const TABS = ['overview', 'tasks', 'milestones', 'updates'] as const
type ProjectTab = (typeof TABS)[number]
function isProjectTab(value: unknown): value is ProjectTab {
  return typeof value === 'string' && (TABS as readonly string[]).includes(value)
}
const tab = computed<ProjectTab>(() => {
  if (route.query.tab === 'list' || route.query.tab === 'board') return 'tasks'
  return isProjectTab(route.query.tab) ? route.query.tab : 'overview'
})
const taskView = computed<'table' | 'board'>(() => route.query.view === 'board' || route.query.tab === 'board' ? 'board' : 'table')

function onTaskViewChange(next: 'table' | 'board') {
  router.replace({ query: { ...route.query, tab: 'tasks', view: next === 'board' ? 'board' : undefined } })
}

const params = computed<TaskListParams>(() => projectTaskParams(projectId.value!, route.query))
function onParams(value: TaskListParams) {
  router.replace({ query: { ...route.query, ...projectTaskQuery(value) } })
}

function taskRouteQuery() {
  const query: LocationQueryRaw = { ...route.query, ...returnToQuery(route.fullPath) }
  query.tab = 'tasks'
  query.view = taskView.value === 'board' ? 'board' : undefined
  return query
}

function openTask(taskId: number) {
  router.push({ path: `/projects/${projectId.value}/tasks/${taskId}`, query: taskRouteQuery() })
}

const stageSource = computed(() => ({ kind: 'project' as const, stages: project.value?.stages ?? [] }))
const projectReturnTo = computed(() => safeReturnTo(route.query.returnTo, '/projects', ['/projects', '/tasks', '/hr', '/settings', '/account', '/search', '/notifications', '/reports']))

function openTaskCreate() {
  router.push({ path: `/projects/${projectId.value}/tasks/new`, query: taskRouteQuery() })
}
function onWorkspaceCreate() {
  const id = projectId.value
  if (!id) return
  const section = workspaceSection.value
  const query = returnToQuery(route.fullPath)
  if (section === 'milestones') router.push({ path: `/projects/${id}/milestones/new`, query })
  else if (section === 'stakeholders') router.push({ path: `/projects/${id}/stakeholders/new`, query })
  else if (section === 'register') router.push({ path: `/projects/${id}/register/new`, query })
  else if (section === 'finance') router.push({ path: `/projects/${id}/finance/new`, query: { ...query, kind: 'expense' } })
  else if (section === 'tasks') openTaskCreate()
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

const dateRange = computed(() => {
  if (!project.value?.date_start && !project.value?.date_end) return t('projects.overview.noDates')
  const format = (value: string | null) => value ? formatCalendarDate(value, locale.value) : '—'
  return `${format(project.value.date_start)} — ${format(project.value.date_end)}`
})
const workspaceCreateLabel = computed(() => {
  if (workspaceSection.value === 'milestones') return t('projects.milestones.new')
  if (workspaceSection.value === 'stakeholders') return t('projects.governance.stakeholder.createTitle')
  if (workspaceSection.value === 'register') return t('projects.governance.registerForm.create')
  if (workspaceSection.value === 'finance') return t('projects.finance.newExpense')
  return t('tasks.new')
})
const showWorkspaceCreate = computed(() => ['tasks', 'milestones', 'stakeholders', 'register', 'finance'].includes(workspaceSection.value))
</script>

<template>
  <SharedPageContainer v-if="isBaseRoute" width="detail">
    <div v-if="notFound" class="flex flex-col items-start gap-3">
      <p class="text-muted-foreground">{{ t('projects.notFound') }}</p>
      <button type="button" class="text-sm underline" @click="router.push(projectReturnTo)">{{ t('projects.backToProjects') }}</button>
    </div>

    <SharedPageState v-else-if="error" :error="error" @retry="refetch" />

    <template v-else>
      <ProjectHeader
        v-if="project"
        :project="project"
        :back-to="projectReturnTo"
        :show-create="showWorkspaceCreate"
        :show-edit="workspaceSection === 'charter'"
        :create-label="workspaceCreateLabel"
        @create="onWorkspaceCreate"
        @edit="openCharterEdit"
        @settings="openSettings"
        @archived="onArchived"
        @unarchived="onUnarchived"
      />
      <Skeleton v-else-if="isLoading" class="h-9 w-1/2" />

      <div class="space-y-4">
        <Card v-if="project" data-testid="project-context" class="nasq-panel overflow-hidden">
          <CardContent class="space-y-4 pb-0 pt-[18px]">
            <div class="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div class="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2">
                <p class="font-mono text-xs text-muted-foreground" dir="ltr">{{ t('projects.projectId', { id: project.id }) }}</p>
                <ProjectStatusSelect v-if="project.can_manage" :project="project" />
                <ProjectStatusBadge v-else :status="project.status" />
                <span class="text-xs text-muted-foreground">{{ dateRange }}</span>
              </div>
              <ProjectProgress :progress="project.progress" :task-count="project.task_count" :closed-task-count="project.closed_task_count" />
            </div>
          </CardContent>
        </Card>

        <div v-if="isBaseRoute && project && tab === 'overview'" class="nasq-detail-grid">
          <div class="grid min-w-0 gap-4">
            <ProjectOverview :project="project" />
            <ProjectOverviewTasks :project-id="project.id" :return-to="route.fullPath" />
          </div>
          <ProjectMetadataRail :project="project" />
        </div>

        <section v-if="isBaseRoute && project && tab === 'tasks'" class="nasq-panel overflow-hidden">
          <div class="nasq-panel-header flex items-center justify-between gap-3">
            <h2 class="text-base font-semibold">{{ t('projects.tabs.tasks') }}</h2>
            <NuxtLink :to="{ path: '/archived-tasks', query: { project_id: project.id, ...returnToQuery(route.fullPath) } }" class="text-sm text-muted-foreground underline underline-offset-4">{{ t('taskLifecycle.archivedTasks') }}</NuxtLink>
          </div>
          <TaskToolbar :model-value="params" :view="taskView" embedded hide-project-filter hide-create @update:model-value="onParams" @update:view="onTaskViewChange" @create="openTaskCreate" />
          <TaskTable v-if="taskView === 'table'" :params="params" variant="project" embedded @open="openTask" @create="openTaskCreate" />
          <TaskBoard v-else :params="params" :stage-source="stageSource" embedded @open="openTask" />
        </section>

        <div v-if="isBaseRoute && project && tab === 'milestones'" class="nasq-detail-grid">
          <MilestoneTable :project-id="project.id" :can-manage="project.can_manage" />
          <ProjectMetadataRail :project="project" />
        </div>

        <div v-if="isBaseRoute && project && tab === 'updates'" class="nasq-detail-grid">
          <ProjectUpdateList :project-id="project.id" :can-manage="project.can_manage" />
          <ProjectMetadataRail :project="project" />
        </div>
      </div>
    </template>
  </SharedPageContainer>
  <NuxtPage />
</template>
