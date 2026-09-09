<script setup lang="ts">
import { toast } from 'vue-sonner'
import TaskCreateForm from '@/components/task/TaskCreateForm.vue'
import { ApiError } from '@/composables/useApi'
import { useProject } from '@/composables/useProjects'
import { safeReturnTo } from '@/utils/safeReturnTo'

const route = useRoute()
const router = useRouter()
const { t } = useI18n()
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
const returnTo = computed(() => projectId.value ? safeReturnTo(route.query.returnTo, '/projects/' + projectId.value + '?tab=tasks', ['/projects']) : '/projects')
function created(_id: number) {
  toast.success(t('tasks.created'))
  router.push(returnTo.value)
}
</script>

<template>
  <SharedPageContainer width="form">
    <SharedPageHeader :title="t('tasks.new')" :back-to="returnTo" :back-label="t('projects.backToProject')" />
    <template v-if="projectId === null">
      <p class="text-muted-foreground">{{ t('tasks.invalidId') }}</p>
    </template>
    <SharedPageState
      v-else
      :loading="isLoading && !project"
      :error="notFound ? null : error"
      :empty="notFound || (!isLoading && !error && !project)"
      :empty-text="t('tasks.notFound')"
      @retry="refetch"
    >
      <Card class="nasq-form"><CardContent><TaskCreateForm mode="project" :project-id="projectId" :milestone-id="milestoneId" :project-start="project?.date_start" :project-end="project?.date_end" :can-manage="project?.can_manage" @created="created" @cancel="router.push(returnTo)" /></CardContent></Card>
    </SharedPageState>
    <p v-if="!hydrated" class="sr-only">{{ t('tasks.loading') }}</p>
  </SharedPageContainer>
</template>
