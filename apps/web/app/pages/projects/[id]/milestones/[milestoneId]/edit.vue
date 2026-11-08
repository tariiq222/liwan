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
const { data: milestones, isLoading: milestonesLoading, error: milestonesError, refetch: refetchMilestones, complete } = useMilestones(projectId)
const milestone = computed(() => milestones.value?.find((item) => item.id === milestoneId.value))
// A later page may still hold the milestone, so "not found" waits until every page has loaded.
const resolving = computed(() => !complete.value && !milestonesError.value)
const notFound = computed(() => projectId.value === null || milestoneId.value === null || (projectError.value instanceof ApiError && [403, 404].includes(projectError.value.status)))
const sourcePaths = useProjectRecordListPaths(projectId, () => [`/projects/${projectId.value}/milestones`])
const backTo = computed(() => recordParentTo(`/projects/${projectId.value}/milestones/${milestoneId.value}`, route.query, sourcePaths.value, route.hash))
function retry() {
  void Promise.all([refetchProject(), refetchMilestones()])
}
</script>

<template>
  <SharedPageContainer>
    <SharedPageHeader :title="t('projects.milestones.edit')" :back-to="backTo" :back-label="t('projects.tabs.milestones')" />
    <template v-if="projectId === null || milestoneId === null">
      <p class="text-muted">{{ t('projects.invalidId') }}</p>
    </template>
    <SharedPageState
      v-else
      :loading="(projectLoading || milestonesLoading || resolving) && !milestone"
      :error="notFound ? null : projectError || milestonesError"
      :empty="notFound || (!projectLoading && !milestonesLoading && !resolving && !milestone)"
      :empty-text="t('projects.milestones.notFound')"
      @retry="retry"
    >
      <p v-if="!project?.can_manage" class="text-muted">{{ t('projects.forbidden') }}</p>
      <SharedFormSection v-else-if="milestone && projectId" panel>
        <MilestoneForm :project-id="projectId" :project-start="project?.date_start" :project-end="project?.date_end" :milestone="milestone" @saved="router.push(backTo)" @cancel="router.push(backTo)" />
      </SharedFormSection>
    </SharedPageState>
  </SharedPageContainer>
</template>
