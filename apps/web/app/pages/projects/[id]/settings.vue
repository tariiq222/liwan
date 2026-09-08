<script setup lang="ts">
import { ApiError } from '@/composables/useApi'
import { useProject } from '@/composables/useProjects'
import ProjectSettingsForm from '@/components/project/ProjectSettingsForm.vue'
import { safeReturnTo } from '@/utils/safeReturnTo'

const route = useRoute()
const { t } = useI18n()
const projectId = computed(() => {
  const n = Number(route.params.id)
  return Number.isInteger(n) && n > 0 ? n : null
})
const { data: project, isLoading, error, refetch } = useProject(projectId)
const notFound = computed(() => projectId.value === null || (error.value instanceof ApiError && [403, 404].includes(error.value.status)))
const canManage = computed(() => project.value?.can_manage ?? false)
const returnTo = computed(() => projectId.value ? safeReturnTo(route.query.returnTo, '/projects/' + projectId.value + '?tab=tasks', ['/projects']) : '/projects')
</script>

<template>
  <SharedPageContainer width="form">
    <SharedPageHeader
      :title="t('projects.settings.title')"
      :description="t('projects.refresh.settings.individualDescription')"
      :eyebrow="project?.name"
      :back-to="returnTo"
      :back-label="t('projects.backToProject')"
    />
    <template v-if="projectId === null">
      <p class="text-muted-foreground">{{ t('projects.invalidId') }}</p>
    </template>
    <SharedPageState
      v-else
      :loading="isLoading && !project"
      :error="notFound ? null : error"
      :empty="notFound || (!isLoading && !error && !project)"
      :empty-text="t('projects.notFound')"
      @retry="refetch"
    >
      <p v-if="!canManage" class="text-muted-foreground">{{ t('projects.forbidden') }}</p>
      <Card v-else-if="project" class="nasq-form"><CardContent><ProjectSettingsForm :project="project" /></CardContent></Card>
    </SharedPageState>
  </SharedPageContainer>
</template>
