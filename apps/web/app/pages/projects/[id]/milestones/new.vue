<script setup lang="ts">
import MilestoneForm from '@/components/project/MilestoneForm.vue'
import { ApiError } from '@/composables/useApi'
import { useProject } from '@/composables/useProjects'
import { safeReturnTo, returnToQuery } from '@/utils/safeReturnTo'

const route = useRoute()
const router = useRouter()
const { t } = useI18n()
const projectId = computed(() => {
  const n = Number(route.params.id)
  return Number.isInteger(n) && n > 0 ? n : null
})
const { data: project, isLoading, error, refetch } = useProject(projectId)
const notFound = computed(() => projectId.value === null || (error.value instanceof ApiError && [403, 404].includes(error.value.status)))
const returnTo = computed(() => projectId.value ? safeReturnTo(route.query.returnTo, '/projects/' + projectId.value + '?tab=milestones', ['/projects']) : '/projects')
function saved(id?: number) {
  if (id) router.push({ path: '/projects/' + projectId.value + '/milestones/' + id + '/edit', query: returnToQuery('/projects/' + projectId.value + '?tab=milestones') })
  else router.push(returnTo.value)
}
</script>

<template>
  <SharedPageContainer width="form">
    <SharedPageHeader :title="t('projects.milestones.new')" :eyebrow="project?.name" :back-to="returnTo" :back-label="t('projects.backToProject')" />
    <template v-if="projectId === null">
      <p class="text-muted-foreground">{{ t('projects.invalidId') }}</p>
    </template>
    <SharedPageState
      v-else
      :loading="isLoading && !project"
      :error="notFound ? null : error"
      :empty="notFound || (!isLoading && !error && !project)"
      :empty-text="notFound ? t('projects.notFound') : t('projects.empty')"
      @retry="refetch"
    >
      <p v-if="!project?.can_manage" class="text-muted-foreground">{{ t('projects.forbidden') }}</p>
      <Card v-else class="nasq-form"><CardContent><MilestoneForm :project-id="projectId" @saved="saved" @cancel="router.push(returnTo)" /></CardContent></Card>
    </SharedPageState>
  </SharedPageContainer>
</template>
