<script setup lang="ts">
import type { RouteLocationRaw } from 'vue-router'
import type { TaskListParams } from '@/composables/useTasks'
import TaskDetailPanel from './TaskDetailPanel.vue'

const props = defineProps<{
  taskId: number
  basePath?: string
  backTo?: RouteLocationRaw
  siblingParams?: TaskListParams
  backLabel?: string
}>()

const route = useRoute()
const router = useRouter()
const { t } = useI18n()
const hydrated = useHydrated()
const backTo = computed(() => props.backTo ?? { path: '/tasks', query: route.query })
const taskIdRef = computed(() => props.taskId)
const { data: task } = useTask(taskIdRef)
const title = computed(() => task.value?.name ?? t('tasks.detail.pageLabel'))

function close() {
  if (!hydrated.value) return
  router.push(backTo.value)
}
</script>

<template>
  <TaskDetailPanel
    data-testid="task-detail-page"
    :task-id="props.taskId"
    :base-path="props.basePath"
    :sibling-params="props.siblingParams"
    :back-to="backTo"
    :back-label="props.backLabel ?? t('tasks.detail.back')"
    @close="close"
  />
</template>
