<script setup lang="ts">
import type { TaskState } from '@webvue/contracts'
import type { LocationQueryRaw } from 'vue-router'
import TaskBoard from '@/components/pmo/tasks/TaskBoard.vue'
import TaskKpiStrip from '@/components/pmo/tasks/TaskKpiStrip.vue'
import TaskTable from '@/components/pmo/tasks/TaskTable.vue'
import TaskToolbar from '@/components/pmo/tasks/TaskToolbar.vue'
import { ApiError } from '@/composables/useApi'
import { projectIdFromPath } from '@/modules/pmo/projectRoutes'
import { projectTaskParams, projectTaskQuery } from '@/composables/projectTaskParams'
import { useProject } from '@/composables/useProjects'
import type { TaskListParams } from '@/composables/useTasks'
import { taskCreatePresetQuery } from '@/utils/taskCreatePolicy'
import { safeReturnTo } from '@webvue/ui/app/utils/safeReturnTo'

const route = useRoute()
const router = useRouter()
const { t } = useI18n()
const { can } = useAccess()
const hydrated = useHydrated()
const { shown: kpisShown } = useKpiVisibility()
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
// The board has no columns to sort, so it queries without the URL's sort.
const boardParams = computed<TaskListParams>(() => ({ ...params.value, sort: undefined }))
const stageSource = computed(() => ({ kind: 'project' as const, stages: project.value?.stages ?? [] }))
// Without the tasks capability every request below is refused: one clear notice replaces the toolbar, KPIs and table.
const canRead = computed(() => can('pmo.tasks.read'))
const canCreate = computed(() => can('pmo.tasks.create') && project.value?.active === true)

// A link out of this list carries the list's own state through, `view`
// included: the detail page hands these keys straight back, so the board
// survives the round trip. A referrer's returnTo is dropped instead of
// forwarded — the section path already names where the record returns to, and
// a stale returnTo on the list URL would redirect this page's own controls.
const liveSearch = ref(typeof route.query.q === 'string' ? route.query.q : '')
const openingTask = ref(false)
watch(() => route.query.q, value => { liveSearch.value = typeof value === 'string' ? value : '' })
const filterQuery = computed<LocationQueryRaw>(() => {
  const { returnTo: _referrer, ...listState } = route.query
  return { ...listState, q: liveSearch.value.trim() || undefined } as LocationQueryRaw
})

function onParams(value: TaskListParams) {
  if (openingTask.value || normalizedPath.value !== `/projects/${projectId.value}/tasks`) return
  router.replace({ query: { ...route.query, ...projectTaskQuery(value) } })
}

function taskTo(taskId: number) {
  return { path: `/projects/${projectId.value}/tasks/${taskId}`, query: filterQuery.value }
}

async function openTask(path: string) {
  if (openingTask.value) return
  openingTask.value = true
  try {
    await router.push({ path, query: filterQuery.value })
  } finally {
    openingTask.value = false
  }
}

// Resolve plain clicks from the live input before Vue has rendered a new href.
// Modified clicks keep the native anchor behavior.
function openLiveLink(event: MouseEvent) {
  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
  const anchor = (event.target as Element).closest<HTMLAnchorElement>('a[href]')
  if (!anchor) return
  const target = new URL(anchor.href)
  if (!new RegExp(`^/projects/${projectId.value}/tasks/(new|[1-9]\\d*)$`).test(target.pathname)) return
  event.preventDefault()
  void openTask(target.pathname)
}

// Table is the first option, so it is the bare URL; the switch writes ?view=board for the board.
const views = computed(() => [
  { value: 'table', label: t('projects.tabs.list'), icon: 'i-lucide-list', testId: 'project-tasks-view-table' },
  { value: 'board', label: t('projects.tabs.board'), icon: 'i-lucide-layout-grid', testId: 'project-tasks-view-board' },
])
const createTo = computed(() => ({ path: `/projects/${projectId.value}/tasks/new`, query: filterQuery.value }))

function openCreate() {
  void openTask(`/projects/${projectId.value}/tasks/new`)
}
// A column '+' returns to this exact list through returnTo, so the preset keys (and the list filters) never
// become part of the list URL.
function columnCreateTo(column: { state?: TaskState; stageId?: number }) {
  return { path: `/projects/${projectId.value}/tasks/new`, query: { returnTo: route.fullPath, ...taskCreatePresetQuery(column) } }
}
</script>

<template>
  <template v-if="isListRoute">
    <SharedPageContainer v-if="!canRead" width="list">
      <SharedForbiddenState />
    </SharedPageContainer>
    <SharedPageContainer v-else-if="notFound || error" width="list">
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
      @click.capture="openLiveLink"
      :title="t('nav.projectTasks')"
      :create-to="canCreate ? createTo : undefined"
      :create-label="t('tasks.new')"
      create-test-id="project-header-create"
      :views="views"
      views-in-filters
      kpi-toggle
    >
      <section class="min-w-0 space-y-4" :aria-label="t('projects.tabs.tasks')">
        <div class="flex justify-end">
          <NuxtLink :to="{ path: '/tasks', query: { scope: 'archived', project_id: projectId, returnTo: route.fullPath } }" class="text-sm text-muted hover:underline">{{ t('taskLifecycle.archivedTasks') }}</NuxtLink>
        </div>
        <TaskKpiStrip v-if="kpisShown" :params="params" />
        <SharedListCard :fill="isBoard">
          <template #filters><TaskToolbar :model-value="params" embedded hide-project-filter @update:model-value="onParams" @search="liveSearch = $event" /></template>
          <TaskTable v-if="!isBoard" :params="params" variant="project" :row-to="task => taskTo(task.id)" @create="openCreate" @update:sort="sort => onParams({ ...params, sort })" />
          <TaskBoard v-else :params="boardParams" :stage-source="stageSource" :create-to="canCreate ? columnCreateTo : undefined" @open="(id: number) => openTask(`/projects/${projectId}/tasks/${id}`)" />
        </SharedListCard>
      </section>
    </SharedListPage>
  </template>
  <NuxtPage />
</template>
