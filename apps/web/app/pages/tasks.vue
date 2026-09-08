<script setup lang="ts">
import { Plus } from '@lucide/vue'
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

const tab = computed(() => (route.query.tab === 'board' ? 'board' : 'table'))
const normalizedPath = computed(() => route.path.replace(/\/+$/, '') || '/')
const isBaseRoute = computed(() => normalizedPath.value === '/tasks')
function onTabChange(v: unknown) {
  router.replace({ query: { ...route.query, tab: v === 'board' ? 'board' : undefined } })
}
function onViewChange(view: 'table' | 'board') {
  onTabChange(view)
}

// Detail is now a real route (/tasks/{id}, see pages/tasks/[id].vue) rather
// than a ?task= query param. Row click / create both push there, carrying
// the current query (?tab and any filters) forward so closing can restore it.
function openTask(id: number) {
  router.push({ path: `/tasks/${id}`, query: returnToQuery(route.fullPath) })
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
  <SharedPageContainer v-if="isBaseRoute" width="list">
    <SharedPageHeader :title="t('tasks.title')" :description="t('tasks.description')">
      <template #actions>
        <NuxtLink v-if="can('pmo.tasks.create')" :to="{ path: '/tasks/new', query: returnToQuery(route.fullPath) }">
          <Button class="gap-2" :disabled="!hydrated">
            <Plus class="size-[18px]" />{{ t('tasks.new') }}
          </Button>
        </NuxtLink>
        <Button as-child variant="outline">
          <NuxtLink :to="{ path: '/archived-tasks', query: returnToQuery(route.fullPath) }">
            {{ t('taskLifecycle.archivedTasks') }}
          </NuxtLink>
        </Button>
      </template>
    </SharedPageHeader>

    <TaskToolbar v-model="params" :view="tab" @update:view="onViewChange" />
    <!-- Query data may resolve after SSR markup is emitted but before
         client hydration starts. Mount the dynamic result surface only
         after this page has hydrated so the toolbar controls above keep
         their listeners and their first click is never lost. -->
    <TaskTable v-if="hydrated && tab === 'table'" :params="params" @open="openTask" @create="openCreate" />
    <TaskBoard v-else-if="hydrated" :params="params" @open="openTask" />

  </SharedPageContainer>
  <NuxtPage />
</template>
