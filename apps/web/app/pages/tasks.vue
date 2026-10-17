<script setup lang="ts">
import type { TaskState } from '@webvue/contracts'
import TaskArchivedList from '@/components/pmo/tasks/TaskArchivedList.vue'
import TaskBoard from '@/components/pmo/tasks/TaskBoard.vue'
import TaskKpiStrip from '@/components/pmo/tasks/TaskKpiStrip.vue'
import TaskTable from '@/components/pmo/tasks/TaskTable.vue'
import TaskToolbar from '@/components/pmo/tasks/TaskToolbar.vue'
import { taskAttributeQuery, withTaskAttributeFilters } from '@/composables/taskFilterParams'
import { normalizeTaskSort } from '@/composables/taskSort'
import type { TaskListParams } from '@/composables/useTasks'
import { useTaskFilters } from '@/composables/useTaskFilters'
import { taskCreatePresetQuery } from '@/utils/taskCreatePolicy'
import { returnToQuery } from '@webvue/ui/app/utils/safeReturnTo'

const route = useRoute()
const router = useRouter()
const { t } = useI18n()
const { can } = useAccess()

// The SSR-rendered toolbar is clickable before hydration attaches its listeners (see useHydrated()).
const hydrated = useHydrated()

const isBoard = computed(() => route.query.view === 'board')
// Archived tasks are a scope of this list (`?scope=archived`), not a page of their own.
const isArchived = computed(() => route.query.scope === 'archived')
const normalizedPath = computed(() => route.path.replace(/\/+$/, '') || '/')
const isBaseRoute = computed(() => normalizedPath.value === '/tasks')
const isCreateRoute = computed(() => normalizedPath.value === '/tasks/new')
const showList = computed(() => isBaseRoute.value || isCreateRoute.value)
// Table is the first option, so it is the bare URL; the switch writes ?view=board for the board.
const views = computed(() => [
  { value: 'table', label: t('projects.filters.tableView'), icon: 'i-lucide-list', testId: 'project-tasks-view-table' },
  { value: 'board', label: t('projects.filters.boardView'), icon: 'i-lucide-layout-grid', testId: 'project-tasks-view-board' },
])

// The retired `?tab=` key is dropped, as the old view switch did.
watch(() => route.query.tab, (tab) => {
  if (tab === undefined || !isBaseRoute.value) return
  const { tab: _legacy, ...rest } = route.query
  void router.replace({ query: rest })
}, { immediate: true })

// Detail is a real route (/tasks/{id}, see pages/tasks/[id].vue). The list's own state travels as
// plain query, not wrapped in a returnTo: the detail page hands the same keys straight back, so
// ?view=board survives the round trip and nothing accumulates in the URL.
function taskTo(id: number) {
  return { path: `/tasks/${id}`, query: { ...route.query } }
}

// Filters persist per browser; useTaskFilters centralizes the localStorage key/defaults so the
// detail page's prev/next lookup reads the exact cache entry this table queries with.
const filters = useTaskFilters()
// The sort is not a stored filter: it lives in the URL (`?sort=`), so refresh, back and direct links keep it, and cycling a
// header to "none" removes the key. The board has no columns to sort, so it queries without it.
// `assignee`, `deadline` and `priority` are stored like the other filters and mirrored in the URL: a key present in the URL
// wins over the stored value (a shared link shows what it was made for), an absent one falls back to it.
const params = computed<TaskListParams>({
  get: () => ({ ...withTaskAttributeFilters(filters.value, route.query), sort: normalizeTaskSort(route.query.sort) }),
  set: ({ sort: _sort, ...rest }) => {
    filters.value = rest
    void router.replace({ query: { ...route.query, ...taskAttributeQuery(rest) } })
  },
})
const boardParams = computed<TaskListParams>(() => ({ ...params.value, sort: undefined }))
function onSort(sort: string | undefined) {
  void router.replace({ query: { ...route.query, sort } })
}

const createTo = computed(() => can('pmo.tasks.create') ? { path: '/tasks/new', query: returnToQuery(route.fullPath) } : undefined)
function openCreate() {
  router.push({ path: '/tasks/new', query: returnToQuery(route.fullPath) })
}
function columnCreateTo(column: { state?: TaskState; stageId?: number }) {
  return { path: '/tasks/new', query: { ...returnToQuery(route.fullPath), ...taskCreatePresetQuery(column) } }
}
</script>

<template>
  <TaskArchivedList v-if="showList && isArchived" />
  <SharedListPage
    v-else-if="showList"
    :title="t('tasks.title')"
    :description="t('tasks.description')"
    :create-to="createTo"
    :create-label="t('tasks.new')"
    :views="views"
    views-in-filters
  >
    <!-- Query data may resolve after SSR markup is emitted but before client hydration starts. Mount
         the dynamic surface (and the toolbar in the card header) only after this page has hydrated so
         no control's first click is lost; the toolbar's selects stay disabled until then. One card and one
         filter row serve both views: switching only swaps what is under the row. -->
    <TaskKpiStrip v-if="hydrated" :params="params" />
    <SharedListCard v-if="hydrated" :fill="isBoard">
      <template #filters><TaskToolbar v-model="params" embedded /></template>
      <TaskTable v-if="!isBoard" :params="params" :row-to="task => taskTo(task.id)" @create="openCreate" @update:sort="onSort" />
      <TaskBoard v-else :params="boardParams" :create-to="createTo ? columnCreateTo : undefined" @open="id => router.push(taskTo(id))" />
    </SharedListCard>
  </SharedListPage>
  <NuxtPage />
</template>
