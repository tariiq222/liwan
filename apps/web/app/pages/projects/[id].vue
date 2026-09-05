<script setup lang="ts">
import MilestoneTable from '@/components/project/MilestoneTable.vue'
import ProjectHeader from '@/components/project/ProjectHeader.vue'
import ProjectUpdateList from '@/components/project/ProjectUpdateList.vue'
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
const hydrated = useHydrated()
const normalizedPath = computed(() => route.path.replace(/\/+$/, '') || '/')
const isBaseRoute = computed(() => normalizedPath.value === `/projects/${route.params.id}`)

const projectId = computed(() => {
  const n = Number(route.params.id)
  return Number.isInteger(n) && n > 0 ? n : null
})
const { data: project, isLoading, error } = useProject(projectId)
// A non-numeric route param never resolves to a project. 404 (missing) and
// 403 (exists, unreadable) both mean "not yours to see" once it does query.
const notFound = computed(() => projectId.value === null || (error.value instanceof ApiError && (error.value.status === 404 || error.value.status === 403)))

const TABS = ['list', 'board', 'milestones', 'updates'] as const
type ProjectTab = (typeof TABS)[number]
function isProjectTab(v: unknown): v is ProjectTab {
  return typeof v === 'string' && (TABS as readonly string[]).includes(v)
}
const tab = computed<ProjectTab>(() => (isProjectTab(route.query.tab) ? route.query.tab : 'list'))
function onTabChange(v: unknown) {
  const next = isProjectTab(v) ? v : 'list'
  router.replace({ query: { ...route.query, tab: next === 'list' ? undefined : next } })
}

// Filters live in the URL (see projectTaskParams.ts) so the nested task page
// and this page query the same cache key and returning restores them.
// Only evaluated behind the v-else (i.e. once notFound is false, so projectId is non-null).
const params = computed<TaskListParams>(() => projectTaskParams(projectId.value!, route.query))
function onParams(p: TaskListParams) {
  router.replace({ query: { ...route.query, ...projectTaskQuery(p) } })
}

function openTask(taskId: number) {
  router.push({
    path: `/projects/${projectId.value}/tasks/${taskId}`,
    query: { ...route.query, ...returnToQuery(route.fullPath) },
  })
}

const stageSource = computed(() => ({ kind: 'project' as const, stages: project.value?.stages ?? [] }))
const projectReturnTo = computed(() => safeReturnTo(route.query.returnTo, '/projects', ['/projects']))

function openTaskCreate() {
  router.push({ path: `/projects/${projectId.value}/tasks/new`, query: returnToQuery(route.fullPath) })
}
function openSettings() {
  router.push({ path: `/projects/${projectId.value}/settings`, query: returnToQuery(route.fullPath) })
}

// ProjectMenu already toasts on archive/unarchive (projects.archived /
// projects.unarchived) before emitting this event, so this handler only
// navigates away — the header menu's ProjectMenu is the only thing that
// fires it (the settings dialog has no archive control).
function onArchived() {
  router.push('/projects')
}

// Unarchive stays on the project page: ProjectMenu already toasted and
// useUnarchiveProject's mutation already replaced the cached ProjectDetail,
// so there is nothing left to do here beyond not navigating away.
function onUnarchived() {}
</script>

<template>
  <div v-if="isBaseRoute" class="space-y-4">
    <div v-if="notFound" class="flex flex-col items-start gap-3">
      <p class="text-muted-foreground">{{ t('projects.notFound') }}</p>
      <button type="button" class="text-sm underline" @click="router.push(projectReturnTo)">{{ t('projects.backToProjects') }}</button>
    </div>

    <template v-else>
      <ProjectHeader v-if="project" :project="project" :back-to="projectReturnTo" @create="openTaskCreate" @settings="openSettings" @archived="onArchived" @unarchived="onUnarchived" />
      <Skeleton v-else-if="isLoading" class="h-9 w-1/2" />

      <NuxtLink v-if="project" :to="{ path: '/archived-tasks', query: { project_id: project.id, ...returnToQuery(route.fullPath) } }" class="text-sm underline">{{ t('taskLifecycle.archivedTasks') }}</NuxtLink>
      <Tabs :model-value="tab" @update:model-value="onTabChange">
        <TabsList>
          <TabsTrigger value="list" :disabled="!hydrated">{{ t('projects.tabs.list') }}</TabsTrigger>
          <TabsTrigger value="board" :disabled="!hydrated">{{ t('projects.tabs.board') }}</TabsTrigger>
          <TabsTrigger value="milestones" :disabled="!hydrated">{{ t('projects.tabs.milestones') }}</TabsTrigger>
          <TabsTrigger value="updates" :disabled="!hydrated">{{ t('projects.tabs.updates') }}</TabsTrigger>
        </TabsList>
        <TabsContent value="list" class="space-y-4">
          <TaskToolbar :model-value="params" hide-project-filter hide-create @update:model-value="onParams" @create="openTaskCreate" />
          <TaskTable :params="params" variant="project" @open="openTask" @create="openTaskCreate" />
        </TabsContent>
        <TabsContent value="board" class="space-y-4">
          <TaskToolbar :model-value="params" hide-project-filter hide-create @update:model-value="onParams" @create="openTaskCreate" />
          <TaskBoard v-if="project" :params="params" :stage-source="stageSource" @open="openTask" />
        </TabsContent>
        <TabsContent value="milestones" class="space-y-4">
          <MilestoneTable :project-id="projectId!" :can-manage="project?.can_manage ?? false" />
        </TabsContent>
        <TabsContent value="updates" class="space-y-4">
          <ProjectUpdateList :project-id="projectId!" :can-manage="project?.can_manage ?? false" />
        </TabsContent>
      </Tabs>

    </template>
  </div>
  <NuxtPage />
</template>
