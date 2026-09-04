<script setup lang="ts">
import CreateTaskDialog from '@/components/task/CreateTaskDialog.vue'
import TaskTable from '@/components/task/TaskTable.vue'
import TaskToolbar from '@/components/task/TaskToolbar.vue'
import { useTaskFilters } from '@/composables/useTaskFilters'

const route = useRoute()
const router = useRouter()
const { t } = useI18n()

const tab = computed(() => (route.query.tab === 'board' ? 'board' : 'table'))
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
// centralizes the localStorage key/defaults so the detail modal's prev/next
// lookup can read the exact same cache entry this table queries with.
const params = useTaskFilters()

const createOpen = ref(false)
</script>

<template>
  <div class="space-y-4">
    <h1 class="text-2xl font-semibold">{{ t('tasks.title') }}</h1>

    <Tabs :model-value="tab" @update:model-value="onTabChange">
      <TabsList>
        <TabsTrigger value="table">{{ t('tasks.table') }}</TabsTrigger>
        <TabsTrigger value="board">{{ t('tasks.board') }}</TabsTrigger>
      </TabsList>

      <TabsContent value="table" class="space-y-4">
        <TaskToolbar v-model="params" @create="createOpen = true" />
        <TaskTable :params="params" @open="openTask" @create="createOpen = true" />
      </TabsContent>

      <TabsContent value="board" />
    </Tabs>

    <CreateTaskDialog v-model:open="createOpen" @created="openTask" />

    <!-- pages/tasks/[id].vue renders the detail modal above this view. -->
    <NuxtPage />
  </div>
</template>
