<script setup lang="ts">
import type { LocationQueryRaw } from 'vue-router'
import TaskBoard from '@/components/pmo/tasks/TaskBoard.vue'
import TaskTable from '@/components/pmo/tasks/TaskTable.vue'
import TaskToolbar from '@/components/pmo/tasks/TaskToolbar.vue'
import { ApiError } from '@/composables/useApi'
import { projectIdFromPath } from '@/composables/nav/activeRoute'
import { projectTaskParams, projectTaskQuery } from '@/composables/projectTaskParams'
import { useProject } from '@/composables/useProjects'
import type { TaskListParams } from '@/composables/useTasks'
import { safeReturnTo } from '@/utils/safeReturnTo'

const route = useRoute()
const router = useRouter()
const { t } = useI18n()
const { can } = useAccess()
const hydrated = useHydrated()
const projectId = computed(() => projectIdFromPath(route.path))
const { data: projectData, error, refetch } = useProject(projectId)
// Same SSR contract as the frame: reveal the cached project only once hydrated.
const project = computed(() => hydrated.value ? projectData.value : undefined)
const notFound = computed(() => projectId.value === null || (error.value instanceof ApiError && (error.value.status === 404 || error.value.status === 403)))
const projectReturnTo = computed(() => safeReturnTo(route.query.returnTo, '/projects', ['/projects', '/tasks', '/hr', '/settings', '/account', '/search', '/notifications', '/reports']))
const isBoard = computed(() => route.query.view === 'board')
const normalizedPath = computed(() => route.path.replace(/\/+$/, '') || '/')
const isListRoute = computed(() => {
  const rest = normalizedPath.value.replace(/^\/projects\/[^/]+\/tasks/, '')
  return rest === '' || rest === '/new'
})
// Only ever evaluated inside the v-else of the not-found branch below, which
// is what rules out a null projectId here.
const params = computed<TaskListParams>(() => projectTaskParams(projectId.value!, route.query))
const stageSource = computed(() => ({ kind: 'project' as const, stages: project.value?.stages ?? [] }))
const canCreate = computed(() => can('pmo.tasks.create') && project.value?.active === true)

// A link out of this list carries the list's own state through, `view`
// included: the detail page hands these keys straight back, so the board
// survives the round trip. A referrer's returnTo is dropped instead of
// forwarded — the section path already names where the record returns to, and
// a stale returnTo on the list URL would redirect this page's own controls.
const filterQuery = computed<LocationQueryRaw>(() => {
  const { returnTo: _referrer, ...listState } = route.query
  return listState as LocationQueryRaw
})

function onParams(value: TaskListParams) {
  router.replace({ query: { ...route.query, ...projectTaskQuery(value) } })
}

function taskTo(taskId: number) {
  return { path: `/projects/${projectId.value}/tasks/${taskId}`, query: filterQuery.value }
}

// Table is the first option, so it is the bare URL; the switch writes ?view=board for the board.
const views = computed(() => [
  { value: 'table', label: t('projects.tabs.list'), icon: 'i-lucide-list', testId: 'project-tasks-view-table' },
  { value: 'board', label: t('projects.tabs.board'), icon: 'i-lucide-layout-grid', testId: 'project-tasks-view-board' },
])
const createTo = computed(() => ({ path: `/projects/${projectId.value}/tasks/new`, query: filterQuery.value }))

function openCreate() {
  router.push({ path: `/projects/${projectId.value}/tasks/new`, query: filterQuery.value })
}
</script>

<template>
  <template v-if="isListRoute">
    <SharedPageContainer v-if="notFound || error" width="list">
      <div v-if="notFound" class="flex flex-col items-start gap-3">
        <p class="text-muted">{{ t('projects.notFound') }}</p>
        <UButton type="button" color="neutral" variant="outline" size="sm" @click="router.push(projectReturnTo)">{{ t('projects.backToProjects') }}</UButton>
      </div>
      <SharedPageState v-else :error="error" @retry="refetch" />
    </SharedPageContainer>
    <!-- The frame is this page's h1: hide-header draws no heading, the create button stays in the header row. -->
    <SharedListPage
      v-else
      hide-header
      :title="t('nav.projectTasks')"
      :create-to="canCreate ? createTo : undefined"
      :create-label="t('tasks.new')"
      create-test-id="project-header-create"
      :views="views"
    >
      <template #filters>
        <TaskToolbar :model-value="params" embedded collapsible hide-project-filter @update:model-value="onParams" />
      </template>
      <section class="min-w-0 space-y-4" :aria-label="t('projects.tabs.tasks')">
        <TaskTable v-if="!isBoard" :params="params" variant="project" :row-to="task => taskTo(task.id)" @create="openCreate" />
        <div v-else class="overflow-hidden rounded-lg bg-default ring ring-default">
          <TaskBoard :params="params" :stage-source="stageSource" embedded @open="(id: number) => router.push(taskTo(id))" />
        </div>
        <div class="flex justify-end">
          <NuxtLink :to="{ path: '/tasks', query: { scope: 'archived', project_id: projectId, returnTo: route.fullPath } }" class="text-sm text-muted hover:underline">{{ t('taskLifecycle.archivedTasks') }}</NuxtLink>
        </div>
      </section>
    </SharedListPage>
  </template>
  <NuxtPage />
</template>
