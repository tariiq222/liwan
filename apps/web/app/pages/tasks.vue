<script setup lang="ts">
import CreateTaskDialog from '@/components/task/CreateTaskDialog.vue'
import TaskBoard from '@/components/task/TaskBoard.vue'
import TaskTable from '@/components/task/TaskTable.vue'
import TaskToolbar from '@/components/task/TaskToolbar.vue'
import { Plus } from 'lucide-vue-next'
import { useTaskFilters } from '@/composables/useTaskFilters'

const route = useRoute()
const router = useRouter()
const { t } = useI18n()

// Same race as TaskToolbar's own tabs (see useHydrated()): this SSR-rendered
// table/board switcher is visible and clickable before hydration attaches
// its listener.
const hydrated = useHydrated()

const tab = computed(() => (route.query.tab === 'board' ? 'board' : 'table'))
const isDetailRoute = computed(() => route.params.id !== undefined)
function onTabChange(v: unknown) {
  router.replace({ query: { ...route.query, tab: v === 'board' ? 'board' : undefined } })
}

// Detail is now a real route (/tasks/{id}, see pages/tasks/[id].vue) rather
// than a ?task= query param. Row click / create both push there, carrying
// the current query (?tab and any filters) forward so closing can restore it.
function openTask(id: number) {
  router.push({ path: `/tasks/${id}`, query: route.query })
}

// Filters persist per browser, per the toolbar's contract; useTaskFilters
// centralizes the localStorage key/defaults so the detail page's prev/next
// lookup can read the exact same cache entry this table queries with.
const params = useTaskFilters()

const createOpen = ref(false)
</script>

<template>
  <div v-if="!isDetailRoute" class="space-y-4">
    <header class="flex flex-wrap items-center justify-between gap-3">
      <h1 class="text-2xl font-semibold">{{ t('tasks.title') }}</h1>
      <Button class="gap-1.5" :disabled="!hydrated" @click="createOpen = true">
        <Plus class="size-4" />{{ t('tasks.new') }}
      </Button>
    </header>

    <Tabs :model-value="tab" @update:model-value="onTabChange">
      <TabsList>
        <TabsTrigger value="table" :disabled="!hydrated">{{ t('tasks.table') }}</TabsTrigger>
        <TabsTrigger value="board" :disabled="!hydrated">{{ t('tasks.board') }}</TabsTrigger>
      </TabsList>

      <TabsContent value="table" class="space-y-4">
        <TaskToolbar v-model="params" hide-create />
        <TaskTable :params="params" @open="openTask" @create="createOpen = true" />
      </TabsContent>

      <TabsContent value="board" class="space-y-4">
        <TaskToolbar v-model="params" hide-create />
        <TaskBoard :params="params" @open="openTask" />
      </TabsContent>
    </Tabs>

    <CreateTaskDialog v-model:open="createOpen" @created="openTask" />

  </div>
  <NuxtPage />
</template>
