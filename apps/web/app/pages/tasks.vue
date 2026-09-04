<script setup lang="ts">
import CreateTaskDialog from '@/components/task/CreateTaskDialog.vue'
import TaskTable from '@/components/task/TaskTable.vue'
import TaskToolbar from '@/components/task/TaskToolbar.vue'
import type { TaskListParams } from '@/composables/useTasks'
import { useTask } from '@/composables/useTasks'

const route = useRoute()
const router = useRouter()
const { t } = useI18n()

const tab = computed(() => (route.query.tab === 'board' ? 'board' : 'table'))
function onTabChange(v: unknown) {
  router.replace({ query: { ...route.query, tab: v === 'board' ? 'board' : undefined } })
}

const taskId = computed(() => {
  const raw = route.query.task
  const n = Number(Array.isArray(raw) ? raw[0] : raw)
  return Number.isFinite(n) && n > 0 ? n : null
})
function openTask(id: number) {
  router.push({ query: { ...route.query, task: id } })
}
function closeDrawer() {
  const { task: _task, ...rest } = route.query
  router.push({ query: rest })
}
const drawerOpen = computed({
  get: () => taskId.value !== null,
  set: (v: boolean) => {
    if (!v) closeDrawer()
  },
})

// Filters persist per browser, per the toolbar's contract; `mergeDefaults`
// means a stored value from before a new filter field existed still works.
const params = useLocalStorage<TaskListParams>('nasq.tasks.filters', { closed: false }, { mergeDefaults: true })

const createOpen = ref(false)

const { data: activeTask } = useTask(taskId)
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

    <Sheet v-model:open="drawerOpen">
      <SheetContent>
        <SheetHeader>
          <SheetTitle>{{ activeTask?.name }}</SheetTitle>
        </SheetHeader>
      </SheetContent>
    </Sheet>
  </div>
</template>
