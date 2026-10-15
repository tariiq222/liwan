<script setup lang="ts">
import TaskDetailPage from '@/components/pmo/tasks/TaskDetailPage.vue'
import { projectTaskParams } from '@/composables/projectTaskParams'

function toPositiveInt(v: unknown): number | null {
  const n = Number(v)
  return Number.isInteger(n) && n > 0 ? n : null
}

const route = useRoute()
const router = useRouter()
const projectId = computed(() => toPositiveInt(route.params.id))
const taskId = computed(() => toPositiveInt(route.params.taskId))
const siblingParams = computed(() => projectTaskParams(projectId.value ?? 0, route.query))
// The section is part of the path, so a project task returns to that project's
// own task list with the state it was opened from still applied. A referrer's
// returnTo is dropped rather than forwarded: on the list URL it would nest on
// every round trip and send that page's "back to projects" button elsewhere.
const backTo = computed(() => {
  const { returnTo: _referrer, ...listState } = route.query
  return { path: `/projects/${projectId.value}/tasks`, query: listState }
})

// A non-numeric project or task id (e.g. /projects/1/tasks/abc) has nothing to
// render; bounce to the task list instead of leaving a broken detail page.
onMounted(() => {
  if (projectId.value === null || taskId.value === null) router.replace(projectId.value === null ? '/projects' : `/projects/${projectId.value}/tasks`)
})
</script>

<template>
  <TaskDetailPage
    v-if="projectId !== null && taskId !== null"
    :task-id="taskId"
    :base-path="`/projects/${projectId}/tasks`"
    :back-to="backTo"
    :sibling-params="siblingParams"
  />
</template>
