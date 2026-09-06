<script setup lang="ts">
import TaskDetailPage from '@/components/task/TaskDetailPage.vue'
import { safeReturnTo } from '@/utils/safeReturnTo'

const route = useRoute()
const router = useRouter()
const taskId = computed(() => {
  const n = Number(route.params.id)
  return Number.isInteger(n) && n > 0 ? n : null
})
const closeTo = computed(() => safeReturnTo(route.query.returnTo, '/tasks', ['/tasks', '/projects', '/hr', '/settings', '/account', '/search', '/notifications']))

onMounted(() => {
  if (taskId.value === null) router.replace('/tasks')
})
</script>

<template>
  <TaskDetailPage v-if="taskId !== null" :task-id="taskId" :close-to="closeTo" />
</template>
