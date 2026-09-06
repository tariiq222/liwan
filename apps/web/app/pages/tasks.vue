<script setup lang="ts">
import TaskBoard from '@/components/task/TaskBoard.vue'
import TaskTable from '@/components/task/TaskTable.vue'
import TaskToolbar from '@/components/task/TaskToolbar.vue'
import { Plus } from '@lucide/vue'
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
  <div v-if="isBaseRoute" class="space-y-4">
    <SharedPageHeader :title="t('tasks.title')" :description="t('tasks.description')">
      <template #actions>
      <div class="flex items-center gap-2">
      <NuxtLink :to="{ path: '/archived-tasks', query: returnToQuery(route.fullPath) }" class="text-sm underline">{{ t('taskLifecycle.archivedTasks') }}</NuxtLink>
      <Button v-if="can('pmo.tasks.create')" class="gap-1.5" :disabled="!hydrated" @click="openCreate">
        <Plus class="size-[18px]" />{{ t('tasks.new') }}
      </Button>
      </div>
      </template>
    </SharedPageHeader>

    <Tabs :model-value="tab" @update:model-value="onTabChange">
      <TabsList>
        <TabsTrigger value="table" :disabled="!hydrated">{{ t('tasks.table') }}</TabsTrigger>
        <TabsTrigger value="board" :disabled="!hydrated">{{ t('tasks.board') }}</TabsTrigger>
      </TabsList>

      <TabsContent value="table" class="space-y-4">
        <TaskToolbar v-model="params" hide-create @create="openCreate" />
        <!-- Query data may resolve after SSR markup is emitted but before
             client hydration starts. Mount the dynamic result surface only
             after this page has hydrated so the toolbar controls above keep
             their listeners and their first click is never lost. -->
        <TaskTable v-if="hydrated" :params="params" @open="openTask" @create="openCreate" />
      </TabsContent>

      <TabsContent value="board" class="space-y-4">
        <TaskToolbar v-model="params" hide-create @create="openCreate" />
        <TaskBoard v-if="hydrated" :params="params" @open="openTask" />
      </TabsContent>
    </Tabs>

  </div>
  <NuxtPage />
</template>
