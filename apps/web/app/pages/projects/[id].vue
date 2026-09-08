<script setup lang="ts">
import type { LocationQueryRaw } from 'vue-router'
import MilestoneTable from '@/components/project/MilestoneTable.vue'
import ProjectHeader from '@/components/project/ProjectHeader.vue'
import ProjectOverview from '@/components/project/ProjectOverview.vue'
import TaskBoard from '@/components/task/TaskBoard.vue'
import TaskTable from '@/components/task/TaskTable.vue'
import TaskToolbar from '@/components/task/TaskToolbar.vue'
import { ApiError } from '@/composables/useApi'
import { projectTaskParams, projectTaskQuery } from '@/composables/projectTaskParams'
import { useProject } from '@/composables/useProjects'
import type { TaskListParams } from '@/composables/useTasks'
import { safeReturnTo, returnToQuery } from '@/utils/safeReturnTo'

const route = useRoute()
const router = useRouter()
const { t } = useI18n()
const { can } = useAccess()
const normalizedPath = computed(() => route.path.replace(/\/+$/, '') || '/')
const isBaseRoute = computed(() => normalizedPath.value === `/projects/${route.params.id}`)

const projectId = computed(() => {
  const n = Number(route.params.id)
  return Number.isInteger(n) && n > 0 ? n : null
})
const { data: project, isLoading, error, refetch } = useProject(projectId)
const notFound = computed(() => projectId.value === null || (error.value instanceof ApiError && (error.value.status === 404 || error.value.status === 403)))

type PlanningView = 'list' | 'board' | 'milestones'
function planningViewOf(tab: unknown, view: unknown): PlanningView | null {
  if (tab === 'milestones') return 'milestones'
  if (tab === 'board' || view === 'board') return 'board'
  if (tab === 'tasks' || tab === 'list') return 'list'
  return null
}
const planningView = computed(() => planningViewOf(route.query.tab, route.query.view))
const isSummary = computed(() => planningView.value === null)
const headerTitle = computed(() => isSummary.value ? t('projects.summaryPage.title') : t('nav.projectPlanning'))
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

function planningLink(view: PlanningView | 'gantt') {
  const query: LocationQueryRaw = { ...route.query }
  delete query.view
  if (view === 'gantt') {
    delete query.tab
    return { path: `/projects/${projectId.value}/schedule`, query }
  }
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
        :title="headerTitle"
        :can-create="workspaceCanCreate"
        :create-label="workspaceCreateLabel"
        @create="onWorkspaceCreate"
        @edit="openCharterEdit"
        @settings="openSettings"
        @archived="onArchived"
        @unarchived="onUnarchived"
      />
      <Skeleton v-else-if="isLoading" class="h-9 w-1/2" />

      <nav v-if="project && planningView" class="nasq-view-switch" :aria-label="t('projects.planning.views')">
        <NuxtLink :to="planningLink('list')" :aria-current="planningView === 'list' ? 'page' : undefined">{{ t('projects.tabs.list') }}</NuxtLink>
        <NuxtLink :to="planningLink('board')" :aria-current="planningView === 'board' ? 'page' : undefined">{{ t('projects.tabs.board') }}</NuxtLink>
        <NuxtLink v-if="project.active" :to="planningLink('gantt')">{{ t('projects.tabs.gantt') }}</NuxtLink>
        <NuxtLink :to="planningLink('milestones')" :aria-current="planningView === 'milestones' ? 'page' : undefined">{{ t('projects.tabs.milestones') }}</NuxtLink>
      </nav>

      <ProjectOverview v-if="project && isSummary" :project="project" />

      <section v-if="isBaseRoute && project && (planningView === 'list' || planningView === 'board')" class="nasq-panel overflow-hidden">
        <div class="nasq-panel-header flex items-center justify-between gap-3">
          <h2>{{ t('projects.tabs.tasks') }}</h2>
          <NuxtLink :to="{ path: '/archived-tasks', query: { project_id: project.id, ...returnToQuery(route.fullPath) } }" class="text-sm text-muted-foreground underline underline-offset-4">{{ t('taskLifecycle.archivedTasks') }}</NuxtLink>
        </div>
        <TaskToolbar :model-value="params" embedded hide-project-filter @update:model-value="onParams" />
        <TaskTable v-if="taskView === 'table'" :params="params" variant="project" embedded @open="openTask" @create="openTaskCreate" />
        <TaskBoard v-else :params="params" :stage-source="stageSource" embedded @open="openTask" />
      </section>

      <div v-if="isBaseRoute && project && planningView === 'milestones'">
        <MilestoneTable :project-id="project.id" :can-manage="project.can_manage" />
      </div>
    </template>
  </SharedPageContainer>
  <NuxtPage />
</template>
