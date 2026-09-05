<script setup lang="ts">
import TaskDetailPage from '@/components/task/TaskDetailPage.vue'
import { projectTaskParams } from '@/composables/projectTaskParams'

function toPositiveInt(v: unknown): number | null {
  const n = Number(v)
  return Number.isInteger(n) && n > 0 ? n : null
}

const route = useRoute()
const router = useRouter()
const { t } = useI18n()
const projectId = computed(() => toPositiveInt(route.params.id))
const taskId = computed(() => toPositiveInt(route.params.taskId))
const siblingParams = computed(() => projectTaskParams(projectId.value ?? 0, route.query))
const closeTo = computed(() => ({ path: `/projects/${projectId.value ?? ''}`, query: route.query }))

// A non-numeric project or task id (e.g. /projects/1/tasks/abc) has nothing to
// render; bounce back to the project instead of leaving a broken detail page.
onMounted(() => {
  if (projectId.value === null || taskId.value === null) router.replace(closeTo.value)
})
</script>

<template>
  <TaskDetailPage
    v-if="projectId !== null && taskId !== null"
    :task-id="taskId"
    :base-path="`/projects/${projectId}/tasks`"
    :close-to="closeTo"
    :sibling-params="siblingParams"
    :back-label="t('projects.backToProject')"
  />
</template>
