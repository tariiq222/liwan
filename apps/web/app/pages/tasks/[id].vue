<script setup lang="ts">
import { owningListBack } from '@/utils/recordListOrigin'
import TaskDetailPage from '@/components/pmo/tasks/TaskDetailPage.vue'

const route = useRoute()
const router = useRouter()
const taskId = computed(() => {
  const n = Number(route.params.id)
  return Number.isInteger(n) && n > 0 ? n : null
})
const sourcePaths = useRecordListPaths(['/tasks'])
const backTo = computed(() => owningListBack(route.query, sourcePaths.value, route.hash))

onMounted(() => {
  if (taskId.value === null) router.replace('/tasks')
})
</script>

<template>
  <TaskDetailPage v-if="taskId !== null" :task-id="taskId" :back-to="backTo" />
</template>
