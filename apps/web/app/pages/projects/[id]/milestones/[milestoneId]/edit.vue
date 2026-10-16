<script setup lang="ts">
import { recordParentTo } from '@/utils/recordListOrigin'
import MilestoneForm from '@/components/pmo/projects/MilestoneForm.vue'
import { ApiError } from '@/composables/useApi'
import { useMilestones } from '@/composables/useMilestones'
import { useProject } from '@/composables/useProjects'

const route = useRoute()
const router = useRouter()
const { t } = useI18n()
const projectId = computed(() => { const n = Number(route.params.id); return Number.isInteger(n) && n > 0 ? n : null })
const milestoneId = computed(() => { const n = Number(route.params.milestoneId); return Number.isInteger(n) && n > 0 ? n : null })
const { data: project, isLoading: projectLoading, error: projectError, refetch: refetchProject } = useProject(projectId)
const { data: milestones, isLoading: milestonesLoading, error: milestonesError, refetch: refetchMilestones } = useMilestones(projectId)
const milestone = computed(() => milestones.value?.find((item) => item.id === milestoneId.value))
const notFound = computed(() => projectId.value === null || milestoneId.value === null || (projectError.value instanceof ApiError && [403, 404].includes(projectError.value.status)))
const sourcePaths = useProjectRecordListPaths(projectId, () => [`/projects/${projectId.value}/milestones`])
const backTo = computed(() => recordParentTo(`/projects/${projectId.value}/milestones/${milestoneId.value}`, route.query, sourcePaths.value, route.hash))
function retry() {
  void Promise.all([refetchProject(), refetchMilestones()])
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
      </SharedFormSection>
      </template>
    </SharedPageState>
  </SharedPageContainer>
</template>
