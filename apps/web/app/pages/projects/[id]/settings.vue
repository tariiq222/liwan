<script setup lang="ts">
import { ApiError } from '@/composables/useApi'
import { useProject } from '@/composables/useProjects'
import ProjectSettingsForm from '@/components/project/ProjectSettingsForm.vue'

const route = useRoute()
const { t } = useI18n()
const projectId = computed(() => {
  const n = Number(route.params.id)
  return Number.isInteger(n) && n > 0 ? n : null
})
const { data: project, isLoading, error, refetch } = useProject(projectId)
const notFound = computed(() => projectId.value === null || (error.value instanceof ApiError && [403, 404].includes(error.value.status)))
const canManage = computed(() => project.value?.can_manage ?? false)
</script>

<template>
  <SharedPageContainer width="list">
    <SharedPageHeader
      :title="t('projects.settings.title')"
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
      <template v-else-if="project">
        <ProjectSettingsForm :project="project" />
      </template>
    </SharedPageState>
  </SharedPageContainer>
</template>
