<script setup lang="ts">
import { toast } from 'vue-sonner'
import MilestoneForm from '@/components/project/MilestoneForm.vue'
import { ApiError } from '@/composables/useApi'
import { useDeleteMilestone, useMilestones } from '@/composables/useMilestones'
import { useProject } from '@/composables/useProjects'
import { safeReturnTo } from '@/utils/safeReturnTo'

const route = useRoute()
const router = useRouter()
const { t } = useI18n()
const hydrated = useHydrated()
const projectId = computed(() => { const n = Number(route.params.id); return Number.isInteger(n) && n > 0 ? n : null })
const milestoneId = computed(() => { const n = Number(route.params.milestoneId); return Number.isInteger(n) && n > 0 ? n : null })
const { data: project, isLoading: projectLoading, error: projectError, refetch: refetchProject } = useProject(projectId)
const { data: milestones, isLoading: milestonesLoading, error: milestonesError, refetch: refetchMilestones } = useMilestones(projectId)
const milestone = computed(() => milestones.value?.find((item) => item.id === milestoneId.value))
const notFound = computed(() => projectId.value === null || milestoneId.value === null || (projectError.value instanceof ApiError && [403, 404].includes(projectError.value.status)))
const returnTo = computed(() => projectId.value ? safeReturnTo(route.query.returnTo, '/projects/' + projectId.value + '?tab=milestones', ['/projects']) : '/projects')
const deleteOpen = ref(false)
const mutationError = ref<string | null>(null)
const { mutateAsync: deleteMilestone, isPending: deleting } = useDeleteMilestone()

function retry() {
  void Promise.all([refetchProject(), refetchMilestones()])
}

async function confirmDelete() {
  if (!milestone.value || milestone.value.task_count > 0 || !projectId.value) return
  mutationError.value = null
  try {
    await deleteMilestone({ projectId: projectId.value, id: milestone.value.id })
    toast.success(t('projects.milestones.deleted'))
    router.push(returnTo.value)
  } catch (e) {
    mutationError.value = e instanceof ApiError ? e.message : t('projects.milestones.deleteError')
  }
}
</script>

<template>
  <SharedPageContainer width="form">
    <SharedPageHeader :title="t('projects.milestones.edit')" :back-to="returnTo" :back-label="t('projects.backToProject')" />
    <template v-if="projectId === null || milestoneId === null">
      <p class="text-muted-foreground">{{ t('projects.invalidId') }}</p>
    </template>
    <SharedPageState
      v-else
      :loading="(projectLoading || milestonesLoading) && !milestone"
      :error="notFound ? null : projectError || milestonesError"
      :empty="notFound || (!projectLoading && !milestonesLoading && !milestone)"
      :empty-text="t('projects.milestones.notFound')"
      @retry="retry"
    >
      <p v-if="!project?.can_manage" class="text-muted-foreground">{{ t('projects.forbidden') }}</p>
      <template v-else-if="milestone && projectId">
      <Card class="nasq-form"><CardContent class="space-y-5">
        <MilestoneForm :project-id="projectId" :project-start="project?.date_start" :project-end="project?.date_end" :milestone="milestone" @saved="router.push(returnTo)" @cancel="router.push(returnTo)" />
        <div v-if="milestone.task_count > 0" class="rounded-md border border-muted p-3 text-sm text-muted-foreground">{{ t('projects.milestones.hasTasks', { count: milestone.task_count }) }}</div>
        <div v-if="deleteOpen" data-testid="milestone-delete-confirm" class="nasq-status-callout-danger space-y-2 p-3 text-sm">
          <p class="font-medium">{{ t('projects.milestones.delete') }}</p><p class="text-muted-foreground">{{ milestone.name }}</p>
          <div class="flex flex-wrap gap-2"><Button variant="outline" :disabled="deleting" @click="deleteOpen = false">{{ t('app.cancel') }}</Button><Button variant="destructive" :disabled="deleting" @click="confirmDelete">{{ t('projects.milestones.delete') }}</Button></div>
          <p v-if="mutationError" role="alert" class="text-destructive">{{ mutationError }}</p>
        </div>
        <Button v-else-if="milestone.task_count === 0" data-testid="milestone-delete" variant="destructive" :disabled="!hydrated" @click="deleteOpen = true">{{ t('projects.milestones.delete') }}</Button>
      </CardContent></Card>
      </template>
    </SharedPageState>
  </SharedPageContainer>
</template>
