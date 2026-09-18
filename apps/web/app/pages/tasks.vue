<script setup lang="ts">
import TaskBoard from '@/components/task/TaskBoard.vue'
import TaskTable from '@/components/task/TaskTable.vue'
import TaskToolbar from '@/components/task/TaskToolbar.vue'
import { useTaskFilters } from '@/composables/useTaskFilters'
import { returnToQuery } from '@/utils/safeReturnTo'

const route = useRoute()
const router = useRouter()
const { t } = useI18n()
const { can } = useAccess()

// Same race as TaskToolbar's own tabs (see useHydrated()): this SSR-rendered
// table/board switcher is visible and clickable before hydration attaches
// its listener.
const hydrated = useHydrated()

const isBoard = computed(() => route.query.view === 'board')
const normalizedPath = computed(() => route.path.replace(/\/+$/, '') || '/')
const isBaseRoute = computed(() => normalizedPath.value === '/tasks')
const isCreateRoute = computed(() => normalizedPath.value === '/tasks/new')
const showList = computed(() => isBaseRoute.value || isCreateRoute.value)
function onViewChange(view: 'table' | 'board') {
  const { tab: _legacy, ...rest } = route.query
  router.replace({ query: { ...rest, view: view === 'board' ? 'board' : undefined } })
}

// Detail is a real route (/tasks/{id}, see pages/tasks/[id].vue). The list's
// own state travels as plain query, not wrapped in a returnTo: the detail page
// hands the same keys straight back, so ?view=board survives the round trip and
// nothing accumulates in the URL.
function openTask(id: number) {
  router.push({ path: `/tasks/${id}`, query: { ...route.query } })
}

// Filters persist per browser, per the toolbar's contract; useTaskFilters
// centralizes the localStorage key/defaults so the detail page's prev/next
// lookup can read the exact same cache entry this table queries with.
const params = useTaskFilters()

function openCreate() {
  router.push({ path: '/tasks/new', query: returnToQuery(route.fullPath) })
}
</script>

<template>
  <SharedPageContainer v-if="showList" width="list">
    <SharedPageHeader :title="t('tasks.title')" :description="t('tasks.description')">
      <template #actions>
        <UButton v-if="can('pmo.tasks.create')" icon="i-lucide-plus" :disabled="!hydrated" :to="{ path: '/tasks/new', query: returnToQuery(route.fullPath) }">
          {{ t('tasks.new') }}
        </UButton>
        <UButton color="neutral" variant="outline" :to="{ path: '/archived-tasks', query: returnToQuery(route.fullPath) }">
          {{ t('taskLifecycle.archivedTasks') }}
        </UButton>
      </template>
    </SharedPageHeader>

    <TaskToolbar v-model="params" :view="isBoard ? 'board' : 'table'" collapsible @update:view="onViewChange" />
    <!-- Query data may resolve after SSR markup is emitted but before
         client hydration starts. Mount the dynamic result surface only
         after this page has hydrated so the toolbar controls above keep
         their listeners and their first click is never lost. -->
    <TaskTable v-if="hydrated && !isBoard" :params="params" @open="openTask" @create="openCreate" />
    <TaskBoard v-else-if="hydrated" :params="params" @open="openTask" />

  </SharedPageContainer>
  <NuxtPage />
</template>
