<script setup lang="ts">
import TaskDetailPage from '@/components/task/TaskDetailPage.vue'

const route = useRoute()
const router = useRouter()
const taskId = computed(() => {
  const n = Number(route.params.id)
  return Number.isInteger(n) && n > 0 ? n : null
})

onMounted(() => {
  if (taskId.value === null) router.replace('/tasks')
})
</script>

<template>
  <TaskDetailPage v-if="taskId !== null" :task-id="taskId" />
</template>
