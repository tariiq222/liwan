<script setup lang="ts">
import TaskDetailModal from '@/components/task/TaskDetailModal.vue'

const route = useRoute()
const taskId = computed(() => Number(route.params.id))
</script>

<template>
  <TaskDetailModal :task-id="taskId" />
</template>
