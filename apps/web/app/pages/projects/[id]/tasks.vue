<script setup lang="ts">
import type { TaskState } from '@liwan/contracts'
import type { LocationQueryRaw } from 'vue-router'
import ProjectNotFoundState from '@/components/pmo/projects/ProjectNotFoundState.vue'
import ScheduleGantt from '@/components/pmo/projects/schedule/ScheduleGantt.vue'
import TaskArchivedTable from '@/components/pmo/tasks/TaskArchivedTable.vue'
import TaskBoard from '@/components/pmo/tasks/TaskBoard.vue'
import TaskKpiStrip from '@/components/pmo/tasks/TaskKpiStrip.vue'
import TaskTable from '@/components/pmo/tasks/TaskTable.vue'
import TaskToolbar from '@/components/pmo/tasks/TaskToolbar.vue'
import { ApiError } from '@/composables/useApi'
import { projectIdFromPath } from '@/modules/pmo/projectRoutes'
import { projectTaskParams, projectTaskQuery } from '@/composables/projectTaskParams'
import { projectTaskScope, projectTaskScopeQuery, type TaskScope } from '@/composables/taskScope'
import { useProject } from '@/composables/useProjects'
import { useProjectTimeline } from '@/composables/useProjectTimeline'
import type { TaskListParams } from '@/composables/useTasks'
import { projectSectionAvailable } from '@/utils/projectTools'
import type { ScheduleScale } from '@/utils/projectSchedule'
import { taskCreatePresetQuery } from '@/utils/taskCreatePolicy'
import { safeReturnTo } from '@liwan/ui/app/utils/safeReturnTo'

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
const openingTask = useListOpening()
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
  // The timeline's links carry their own return target and `#schedule`: they open as they are.
  if (!anchor || isTimeline.value) return
  const target = new URL(anchor.href)
  if (!new RegExp(`^/projects/${projectId.value}/tasks/(new|[1-9]\\d*)$`).test(target.pathname)) return
  event.preventDefault()
  void openTask(target.pathname)
}

// Table is the first option, so it is the bare URL; the switch writes ?view=board or ?view=timeline. The timeline is the
// project's schedule, offered while its planning tool is on (until the project has loaded it is assumed on).
const timelineAvailable = computed(() => !project.value || projectSectionAvailable('planning', project.value.tools))
const views = computed(() => [
  { value: 'table', label: t('projects.tabs.list'), icon: 'i-lucide-list', testId: 'project-tasks-view-table' },
  { value: 'board', label: t('projects.tabs.board'), icon: 'i-lucide-layout-grid', testId: 'project-tasks-view-board' },
  ...(timelineAvailable.value ? [{ value: 'timeline', label: t('projects.tabs.gantt'), icon: 'i-lucide-chart-gantt', testId: 'project-tasks-view-timeline' }] : []),
])
const scope = computed(() => projectTaskScope(route.query))
const isArchived = computed(() => scope.value === 'archived')
const isBoard = computed(() => !isArchived.value && route.query.view === 'board')
const isTimeline = computed(() => !isArchived.value && timelineAvailable.value && route.query.view === 'timeline')
const archivedParams = computed(() => ({ project_id: projectId.value ?? undefined, mine: false, q: params.value.q }))
const { schedule, baseline, scale, scales, rangeLabel, gantt } = useProjectTimeline(projectId, project, isTimeline)

function setScale(value: string) {
  scale.value = value as ScheduleScale
}
function onScope(next: TaskScope) {
  void router.replace({ query: { ...route.query, ...projectTaskScopeQuery(next) } })
}
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
    <SharedPageContainer v-if="!canRead">
      <SharedForbiddenState />
    </SharedPageContainer>
    <SharedPageContainer v-else-if="notFound || error">
      <ProjectNotFoundState v-if="notFound" embedded :back-to="projectReturnTo" />
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
        <TaskKpiStrip v-if="kpisShown && !isArchived" :params="params" />
        <SharedListCard :fill="isBoard">
          <template #filters>
            <TaskToolbar :model-value="params" variant="project" :scope="scope" hide-project-filter @update:model-value="onParams" @update:scope="onScope" @search="liveSearch = $event">
              <template #timeline>
                <SharedTimelineControls :range-label="rangeLabel" :scale="scale" :scales="scales" @prev="gantt?.scrollPage(-1)" @next="gantt?.scrollPage(1)" @today="gantt?.scrollToToday()" @update:scale="setScale" />
              </template>
            </TaskToolbar>
          </template>
          <TaskArchivedTable v-if="isArchived" :params="archivedParams" hide-project />
          <SharedPageState v-else-if="isTimeline" :loading="schedule.isLoading.value && !schedule.data.value" :error="schedule.error.value" :empty="!schedule.isLoading.value && !schedule.data.value && !schedule.error.value" :empty-text="t('projects.schedule.empty')" @retry="schedule.refetch()">
            <ScheduleGantt v-if="schedule.data.value" ref="gantt" :schedule="schedule.data.value" :scale="scale" :baseline="baseline" :project-start="project?.date_start" :project-end="project?.date_end" />
          </SharedPageState>
          <TaskTable v-else-if="!isBoard" :params="params" variant="project" :can-create="canCreate" :row-to="task => taskTo(task.id)" @create="openCreate" @update:sort="sort => onParams({ ...params, sort })" />
          <TaskBoard v-else :params="boardParams" :stage-source="stageSource" :card-to="(id: number) => ({ path: `/projects/${projectId}/tasks/${id}`, query: filterQuery })" :create-to="canCreate ? columnCreateTo : undefined" @open="(id: number) => openTask(`/projects/${projectId}/tasks/${id}`)" />
        </SharedListCard>
      </section>
    </SharedListPage>
  </template>
  <NuxtPage />
</template>
