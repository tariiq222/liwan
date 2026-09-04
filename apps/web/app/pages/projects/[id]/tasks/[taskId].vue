<script setup lang="ts">
import TaskDetailModal from '@/components/task/TaskDetailModal.vue'
import { projectTaskParams } from '@/composables/projectTaskParams'

const route = useRoute()
const projectId = computed(() => Number(route.params.id))
const taskId = computed(() => Number(route.params.taskId))
const siblingParams = computed(() => projectTaskParams(projectId.value, route.query))
const closeTo = computed(() => ({ path: `/projects/${projectId.value}`, query: route.query }))
</script>

<template>
  <TaskDetailModal :task-id="taskId" :base-path="`/projects/${projectId}/tasks`" :close-to="closeTo" :sibling-params="siblingParams" />
</template>
