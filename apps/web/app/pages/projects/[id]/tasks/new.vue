<script setup lang="ts">
import { owningListBack } from '@/utils/recordListOrigin'
import TaskCreateForm from '@/components/pmo/tasks/TaskCreateForm.vue'
import { ApiError } from '@/composables/useApi'
import { useProject } from '@/composables/useProjects'

const route = useRoute()
const router = useRouter()
const { t } = useI18n()
const toast = useToast()
const hydrated = useHydrated()
const projectId = computed(() => {
  const n = Number(route.params.id)
  return Number.isInteger(n) && n > 0 ? n : null
})
const milestoneId = computed(() => {
  const n = Number(route.query.milestone_id)
  return Number.isInteger(n) && n > 0 ? n : null
})
const { data: project, isLoading, error, refetch } = useProject(projectId)
const notFound = computed(() => projectId.value === null || (error.value instanceof ApiError && [403, 404].includes(error.value.status)))
const sourcePaths = useProjectRecordListPaths(projectId, () => [`/projects/${projectId.value}/tasks`])
const backTo = computed(() => owningListBack(route.query, sourcePaths.value, route.hash))
function created(id: number) {
  toast.add({ title: t('tasks.created'), color: 'success', icon: 'i-lucide-circle-check' })
  router.replace({ path: `/projects/${projectId.value}/tasks/${id}`, query: { returnTo: router.resolve(backTo.value).fullPath } })
}
</script>

<template>
  <SharedCreatePanel :title="t('tasks.new')" :back-to="backTo">
    <template v-if="projectId === null">
      <p class="text-muted">{{ t('tasks.invalidId') }}</p>
    </template>
    <SharedPageState
      v-else
      :loading="isLoading && !project"
      :error="notFound ? null : error"
      :empty="notFound || (!isLoading && !error && !project)"
      :empty-text="t('tasks.notFound')"
      @retry="refetch"
    >
      <TaskCreateForm mode="project" :project-id="projectId" :milestone-id="milestoneId" :project-start="project?.date_start" :project-end="project?.date_end" :can-manage="project?.can_manage" @created="created" @cancel="router.push(backTo)" />
    </SharedPageState>
    <p v-if="!hydrated" class="sr-only">{{ t('tasks.loading') }}</p>
  </SharedCreatePanel>
</template>
