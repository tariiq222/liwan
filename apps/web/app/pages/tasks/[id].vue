<script setup lang="ts">
import TaskDetailPage from '@/components/task/TaskDetailPage.vue'

const route = useRoute()
const router = useRouter()
const taskId = computed(() => {
  const n = Number(route.params.id)
  return Number.isInteger(n) && n > 0 ? n : null
})
// The list this task belongs to is the path it hangs off, so the return trip
// is literal — it only has to carry the filters the list is showing.
const backTo = computed(() => ({ path: '/tasks', query: route.query }))

onMounted(() => {
  if (taskId.value === null) router.replace('/tasks')
})
</script>

<template>
  <TaskDetailPage v-if="taskId !== null" :task-id="taskId" :back-to="backTo" />
</template>
