<script setup lang="ts">
import MilestoneForm from '@/components/pmo/projects/MilestoneForm.vue'
import { ApiError } from '@/composables/useApi'
import { useDeleteMilestone, useMilestones } from '@/composables/useMilestones'
import { useProject } from '@/composables/useProjects'

const route = useRoute()
const router = useRouter()
const { t } = useI18n()
const toast = useToast()
const hydrated = useHydrated()
const projectId = computed(() => { const n = Number(route.params.id); return Number.isInteger(n) && n > 0 ? n : null })
const milestoneId = computed(() => { const n = Number(route.params.milestoneId); return Number.isInteger(n) && n > 0 ? n : null })
const { data: project, isLoading: projectLoading, error: projectError, refetch: refetchProject } = useProject(projectId)
const { data: milestones, isLoading: milestonesLoading, error: milestonesError, refetch: refetchMilestones } = useMilestones(projectId)
const milestone = computed(() => milestones.value?.find((item) => item.id === milestoneId.value))
const notFound = computed(() => projectId.value === null || milestoneId.value === null || (projectError.value instanceof ApiError && [403, 404].includes(projectError.value.status)))
// The owning section list is fixed by this page's own route, so the return trip
// is literal and carries only the state that list was showing. A referrer's
// returnTo is dropped rather than forwarded: on the list URL it would nest one
// level deeper on every round trip and redirect that page's own controls.
const backTo = computed(() => {
  const { returnTo: _referrer, ...listQuery } = route.query
  return { path: `/projects/${projectId.value}/milestones`, query: listQuery }
})
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
    toast.add({ title: t('projects.milestones.deleted'), color: 'success', icon: 'i-lucide-circle-check' })
    router.push(backTo.value)
  } catch (e) {
    mutationError.value = e instanceof ApiError ? e.message : t('projects.milestones.deleteError')
  }
}
</script>

<template>
  <SharedPageContainer width="form">
    <SharedPageHeader :title="t('projects.milestones.edit')" :back-to="backTo" :back-label="t('projects.backToProject')" />
    <template v-if="projectId === null || milestoneId === null">
      <p class="text-muted">{{ t('projects.invalidId') }}</p>
    </template>
    <SharedPageState
      v-else
      :loading="(projectLoading || milestonesLoading) && !milestone"
      :error="notFound ? null : projectError || milestonesError"
      :empty="notFound || (!projectLoading && !milestonesLoading && !milestone)"
      :empty-text="t('projects.milestones.notFound')"
      @retry="retry"
    >
      <p v-if="!project?.can_manage" class="text-muted">{{ t('projects.forbidden') }}</p>
      <template v-else-if="milestone && projectId">
      <SharedFormSection panel class="space-y-5">
        <MilestoneForm :project-id="projectId" :project-start="project?.date_start" :project-end="project?.date_end" :milestone="milestone" @saved="router.push(backTo)" @cancel="router.push(backTo)" />
        <div v-if="milestone.task_count > 0" class="rounded-md border border-default p-3 text-sm text-muted">{{ t('projects.milestones.hasTasks', { count: milestone.task_count }, milestone.task_count) }}</div>
        <SharedInlineConfirm
          v-if="deleteOpen"
          data-testid="milestone-delete-confirm"
          :title="t('projects.milestones.deleteConfirm', { name: milestone.name })"
          :confirm-label="t('projects.milestones.delete')"
          :pending="deleting"
          @cancel="deleteOpen = false"
          @confirm="confirmDelete"
        >
          <p v-if="mutationError" role="alert" class="text-error">{{ mutationError }}</p>
        </SharedInlineConfirm>
        <UButton v-else-if="milestone.task_count === 0" data-testid="milestone-delete" color="error" variant="outline" icon="i-lucide-trash-2" :disabled="!hydrated" @click="deleteOpen = true">{{ t('projects.milestones.delete') }}</UButton>
      </SharedFormSection>
      </template>
    </SharedPageState>
  </SharedPageContainer>
</template>
