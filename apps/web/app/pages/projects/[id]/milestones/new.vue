<script setup lang="ts">
import { owningListBack } from '@/utils/recordListOrigin'
import MilestoneForm from '@/components/pmo/projects/MilestoneForm.vue'
import { ApiError } from '@/composables/useApi'
import { useProject } from '@/composables/useProjects'

const route = useRoute()
const router = useRouter()
const { t } = useI18n()
const projectId = computed(() => {
  const n = Number(route.params.id)
  return Number.isInteger(n) && n > 0 ? n : null
})
const { data: project, isLoading, error, refetch } = useProject(projectId)
const notFound = computed(() => projectId.value === null || (error.value instanceof ApiError && [403, 404].includes(error.value.status)))
const sourcePaths = useProjectRecordListPaths(projectId, () => [`/projects/${projectId.value}/milestones`])
const backTo = computed(() => owningListBack(route.query, sourcePaths.value, route.hash))
function saved(id?: number) { router.replace(id ? { path: `/projects/${projectId.value}/milestones/${id}`, query: { returnTo: router.resolve(backTo.value).fullPath } } : backTo.value) }
</script>

<template>
  <SharedCreatePanel :title="t('projects.milestones.new')" :back-to="backTo">
    <template v-if="projectId === null">
      <p class="text-muted">{{ t('projects.invalidId') }}</p>
    </template>
    <SharedPageState
      v-else
      :loading="isLoading && !project"
      :error="notFound ? null : error"
      :empty="notFound || (!isLoading && !error && !project)"
      :empty-text="notFound ? t('projects.notFound') : t('projects.empty')"
      @retry="refetch"
    >
      <p v-if="!project?.can_manage" class="text-muted">{{ t('projects.forbidden') }}</p>
      <MilestoneForm v-else :project-id="projectId" :project-start="project?.date_start" :project-end="project?.date_end" @saved="saved" @cancel="router.push(backTo)" />
    </SharedPageState>
  </SharedCreatePanel>
</template>
