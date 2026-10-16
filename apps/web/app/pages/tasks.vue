<script setup lang="ts">
import TaskArchivedList from '@/components/pmo/tasks/TaskArchivedList.vue'
import TaskBoard from '@/components/pmo/tasks/TaskBoard.vue'
import TaskTable from '@/components/pmo/tasks/TaskTable.vue'
import TaskToolbar from '@/components/pmo/tasks/TaskToolbar.vue'
import { useTaskFilters } from '@/composables/useTaskFilters'
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
const params = useTaskFilters()

const createTo = computed(() => can('pmo.tasks.create') ? { path: '/tasks/new', query: returnToQuery(route.fullPath) } : undefined)
function openCreate() {
  router.push({ path: '/tasks/new', query: returnToQuery(route.fullPath) })
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
  >
    <template #actions>
      <UButton color="neutral" variant="outline" :to="{ path: '/tasks', query: { ...returnToQuery(route.fullPath), scope: 'archived' } }" data-testid="tasks-archived-link">
        {{ t('taskLifecycle.archivedTasks') }}
      </UButton>
    </template>
    <template #filters>
      <TaskToolbar v-model="params" collapsible />
    </template>
    <!-- Query data may resolve after SSR markup is emitted but before client hydration starts. Mount
         the dynamic result surface only after this page has hydrated so the toolbar controls above
         keep their listeners and their first click is never lost. -->
    <TaskTable v-if="hydrated && !isBoard" :params="params" :row-to="task => taskTo(task.id)" @create="openCreate" />
    <TaskBoard v-else-if="hydrated" :params="params" @open="id => router.push(taskTo(id))" />
  </SharedListPage>
  <NuxtPage />
</template>
