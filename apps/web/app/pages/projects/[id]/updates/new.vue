<script setup lang="ts">
import ProjectUpdateForm from '@/components/project/ProjectUpdateForm.vue'
import { ApiError } from '@/composables/useApi'
import { useProject } from '@/composables/useProjects'
import { safeReturnTo } from '@/utils/safeReturnTo'

const route = useRoute()
const router = useRouter()
const { t } = useI18n()
const projectId = computed(() => {
  const n = Number(route.params.id)
  return Number.isInteger(n) && n > 0 ? n : null
})
const { data: project, isLoading, error, refetch } = useProject(projectId)
const notFound = computed(() => projectId.value === null || (error.value instanceof ApiError && [403, 404].includes(error.value.status)))
const returnTo = computed(() => projectId.value ? safeReturnTo(route.query.returnTo, '/projects/' + projectId.value + '?tab=updates', ['/projects']) : '/projects')
</script>

<template>
  <SharedPageContainer width="form">
    <SharedPageHeader :title="t('projects.updates.new')" :back-to="returnTo" :back-label="t('projects.backToProject')" />
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
      <section v-else class="nasq-ui-record-surface"><div class="p-5"><ProjectUpdateForm :project-id="projectId" @saved="router.push(returnTo)" @cancel="router.push(returnTo)" /></div></section>
    </SharedPageState>
  </SharedPageContainer>
</template>
