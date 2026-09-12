<script setup lang="ts">
import TaskDetailPage from '@/components/task/TaskDetailPage.vue'

const route = useRoute()
const router = useRouter()
const taskId = computed(() => {
  const n = Number(route.params.id)
  return Number.isInteger(n) && n > 0 ? n : null
})
// The list this task belongs to is the path it hangs off, so the return trip is
// literal — it only carries the filters the list was showing. A referrer's
// returnTo must not ride along: it would land on the list URL, nest one level
// deeper on every further round trip, and point list controls somewhere else.
const backTo = computed(() => {
  const { returnTo: _referrer, ...listQuery } = route.query
  return { path: '/tasks', query: listQuery }
})

onMounted(() => {
  if (taskId.value === null) router.replace('/tasks')
})
</script>

<template>
  <TaskDetailPage v-if="taskId !== null" :task-id="taskId" :back-to="backTo" />
</template>
