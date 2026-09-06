<script setup lang="ts">
import type { RouteLocationRaw } from 'vue-router'
import type { TaskListParams } from '@/composables/useTasks'
import { useTask } from '@/composables/useTasks'
import TaskDetailPanel from './TaskDetailPanel.vue'

const props = defineProps<{
  taskId: number
  basePath?: string
  closeTo?: RouteLocationRaw
  siblingParams?: TaskListParams
  backLabel?: string
}>()

const route = useRoute()
const router = useRouter()
const { t } = useI18n()
const taskIdRef = computed(() => props.taskId)
const { data: task } = useTask(taskIdRef)
const title = computed(() => task.value?.name ?? t('tasks.detail.pageLabel'))
usePageHeader(title)

function close() {
  router.push(props.closeTo ?? { path: '/tasks', query: route.query })
}
</script>

<template>
  <section data-testid="task-detail-page" class="nasq-page-stack mx-auto w-full max-w-[1440px]">
    <TaskDetailPanel
      :task-id="props.taskId"
      :base-path="props.basePath"
      :sibling-params="props.siblingParams"
      :back-label="props.backLabel ?? t('tasks.detail.back')"
      @close="close"
    />
  </section>
</template>
