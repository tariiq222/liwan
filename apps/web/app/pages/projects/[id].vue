<script setup lang="ts">
import type { LocationQueryRaw } from 'vue-router'
import MilestoneTable from '@/components/project/MilestoneTable.vue'
import ProjectHeader from '@/components/project/ProjectHeader.vue'
import ProjectOverviewTasks from '@/components/project/ProjectOverviewTasks.vue'
import ProjectUpdateList from '@/components/project/ProjectUpdateList.vue'
import TaskBoard from '@/components/task/TaskBoard.vue'
import TaskTable from '@/components/task/TaskTable.vue'
import TaskToolbar from '@/components/task/TaskToolbar.vue'
import { ApiError } from '@/composables/useApi'
import { projectTaskParams, projectTaskQuery } from '@/composables/projectTaskParams'
import { useProject } from '@/composables/useProjects'
import type { TaskListParams } from '@/composables/useTasks'
import { sanitizeHtml } from '@/utils/sanitize'
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

const TABS = ['overview', 'list', 'board', 'milestones', 'updates'] as const
type ProjectTab = (typeof TABS)[number]
function isProjectTab(v: unknown): v is ProjectTab {
  return typeof v === 'string' && (TABS as readonly string[]).includes(v)
}
const tab = computed<ProjectTab>(() => (isProjectTab(route.query.tab) ? route.query.tab : 'overview'))
function onTabChange(v: unknown) {
  const next = isProjectTab(v) ? v : 'overview'
  router.replace({ query: { ...route.query, tab: next === 'overview' ? undefined : next } })
}

// Filters live in the URL (see projectTaskParams.ts) so the nested task page
// and this page query the same cache key and returning restores them.
// Only evaluated behind the v-else (i.e. once notFound is false, so projectId is non-null).
const params = computed<TaskListParams>(() => projectTaskParams(projectId.value!, route.query))
function onParams(p: TaskListParams) {
  router.replace({ query: { ...route.query, ...projectTaskQuery(p) } })
}

function taskRouteQuery() {
  const query: LocationQueryRaw = { ...route.query, ...returnToQuery(route.fullPath) }
  if (tab.value === 'list' || tab.value === 'board') query.tab = tab.value
  return query
}

function openTask(taskId: number) {
  router.push({
    path: `/projects/${projectId.value}/tasks/${taskId}`,
    query: taskRouteQuery(),
  })
}

const stageSource = computed(() => ({ kind: 'project' as const, stages: project.value?.stages ?? [] }))
const projectReturnTo = computed(() => safeReturnTo(route.query.returnTo, '/projects', ['/projects', '/tasks', '/hr', '/settings', '/account', '/search', '/notifications']))

function openTaskCreate() {
  router.push({ path: `/projects/${projectId.value}/tasks/new`, query: taskRouteQuery() })
}
function openSettings() {
  router.push({ path: `/projects/${projectId.value}/settings`, query: returnToQuery(route.fullPath) })
}

// ProjectHeader already toasts on archive/unarchive (projects.archived /
// projects.unarchived) before emitting this event, so this handler only
// navigates away.
function onArchived() {
  router.push('/projects')
}

// Unarchive stays on the project page: ProjectHeader already toasted and
// useUnarchiveProject's mutation already replaced the cached ProjectDetail,
// so there is nothing left to do here beyond not navigating away.
function onUnarchived() {}
</script>

<template>
  <div v-if="isBaseRoute" class="space-y-6">
    <div v-if="notFound" class="flex flex-col items-start gap-3">
      <p class="text-muted-foreground">{{ t('projects.notFound') }}</p>
      <button type="button" class="text-sm underline" @click="router.push(projectReturnTo)">{{ t('projects.backToProjects') }}</button>
    </div>

    <template v-else>
      <ProjectHeader v-if="project" :project="project" :back-to="projectReturnTo" @create="openTaskCreate" @settings="openSettings" @archived="onArchived" @unarchived="onUnarchived" />
      <Skeleton v-else-if="isLoading" class="h-9 w-1/2" />

      <NuxtLink v-if="project" :to="{ path: '/archived-tasks', query: { project_id: project.id, ...returnToQuery(route.fullPath) } }" class="text-sm text-muted-foreground underline underline-offset-4">{{ t('taskLifecycle.archivedTasks') }}</NuxtLink>

      <Tabs :model-value="tab" class="space-y-4" @update:model-value="onTabChange">
        <Card v-if="project" class="overflow-hidden">
          <CardContent class="p-4 sm:p-5">
            <div class="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div class="min-w-0 space-y-2">
                <p class="font-mono text-xs text-muted-foreground" dir="ltr">{{ t('projects.projectId', { id: project.id }) }}</p>
                <div class="max-w-3xl text-sm leading-6 text-muted-foreground" v-html="sanitizeHtml(project.description_html)" />
              </div>
              <ProjectProgress :progress="project.progress" :task-count="project.task_count" :closed-task-count="project.closed_task_count" />
            </div>
          </CardContent>
          <TabsList class="h-auto w-full flex-wrap justify-start rounded-none border-t bg-transparent p-0 px-4 sm:px-5">
            <TabsTrigger value="overview" :disabled="!hydrated" class="rounded-none border-b-2 border-transparent px-3 py-3 data-[state=active]:border-ring data-[state=active]:bg-transparent">{{ t('projects.tabs.overview') }}</TabsTrigger>
            <TabsTrigger value="list" :disabled="!hydrated" class="rounded-none border-b-2 border-transparent px-3 py-3 data-[state=active]:border-ring data-[state=active]:bg-transparent">{{ t('projects.tabs.list') }}</TabsTrigger>
            <TabsTrigger value="board" :disabled="!hydrated" class="rounded-none border-b-2 border-transparent px-3 py-3 data-[state=active]:border-ring data-[state=active]:bg-transparent">{{ t('projects.tabs.board') }}</TabsTrigger>
            <TabsTrigger value="milestones" :disabled="!hydrated" class="rounded-none border-b-2 border-transparent px-3 py-3 data-[state=active]:border-ring data-[state=active]:bg-transparent">{{ t('projects.tabs.milestones') }}</TabsTrigger>
            <TabsTrigger value="updates" :disabled="!hydrated" class="rounded-none border-b-2 border-transparent px-3 py-3 data-[state=active]:border-ring data-[state=active]:bg-transparent">{{ t('projects.tabs.updates') }}</TabsTrigger>
          </TabsList>
        </Card>
        <TabsContent value="overview" class="space-y-4">
          <div v-if="project" class="grid gap-4 md:grid-cols-2">
            <Card>
              <CardHeader class="pb-3"><CardTitle class="text-base">{{ t('projects.overview.title') }}</CardTitle></CardHeader>
              <CardContent class="grid gap-3 sm:grid-cols-3">
                <div class="rounded-lg border bg-muted/30 p-3"><p class="text-xs text-muted-foreground">{{ t('projects.overview.progress') }}</p><p class="mt-1 text-xl font-semibold tabular-nums">{{ project.progress }}%</p></div>
                <div class="rounded-lg border bg-muted/30 p-3"><p class="text-xs text-muted-foreground">{{ t('projects.overview.openTasks') }}</p><p class="mt-1 text-xl font-semibold tabular-nums">{{ project.task_count - project.closed_task_count }}</p></div>
                <div class="rounded-lg border bg-muted/30 p-3"><p class="text-xs text-muted-foreground">{{ t('projects.overview.milestones') }}</p><p class="mt-1 text-xl font-semibold tabular-nums">{{ project.milestone_count }}</p></div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader class="pb-3"><CardTitle class="text-base">{{ t('projects.overview.metadata') }}</CardTitle></CardHeader>
              <CardContent class="space-y-3 text-sm">
                <div class="flex items-center justify-between gap-3 border-b pb-3"><span class="text-muted-foreground">{{ t('projects.settings.manager') }}</span><span>{{ project.manager?.name ?? t('projects.settings.noManager') }}</span></div>
                <div class="flex items-center justify-between gap-3 border-b pb-3"><span class="text-muted-foreground">{{ t('projects.settings.dateStart') }}</span><span dir="ltr">{{ project.date_start ?? '—' }}</span></div>
                <div class="flex items-center justify-between gap-3"><span class="text-muted-foreground">{{ t('projects.settings.dateEnd') }}</span><span dir="ltr">{{ project.date_end ?? '—' }}</span></div>
              </CardContent>
            </Card>
          </div>
          <ProjectOverviewTasks v-if="project && tab === 'overview'" :project-id="project.id" :return-to="route.fullPath" />
        </TabsContent>
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
