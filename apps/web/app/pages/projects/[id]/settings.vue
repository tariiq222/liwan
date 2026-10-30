<script setup lang="ts">
import { ApiError } from '@/composables/useApi'
import { useProject } from '@/composables/useProjects'
import ProjectNotFoundState from '@/components/pmo/projects/ProjectNotFoundState.vue'
import ProjectSettingsForm from '@/components/pmo/projects/ProjectSettingsForm.vue'

const route = useRoute()
const { t } = useI18n()
const projectId = computed(() => {
  const n = Number(route.params.id)
  return Number.isInteger(n) && n > 0 ? n : null
})
const hydrated = useHydrated()
const { data: projectData, isLoading, error, refetch } = useProject(projectId)
// Same SSR contract as the frame: reveal the cached project only once hydrated, so the first client tree matches the server's.
const project = computed(() => hydrated.value ? projectData.value : undefined)
const notFound = computed(() => projectId.value === null || (error.value instanceof ApiError && [403, 404].includes(error.value.status)))
const canManage = computed(() => project.value?.can_manage ?? false)
</script>

<template>
  <ProjectNotFoundState v-if="notFound" />
  <SharedSettingsPage v-else width="list">
    <SharedPageHeader
      :title="t('projects.settings.title')"
    />
    <SharedPageState
      :loading="!project && !error && (isLoading || !hydrated)"
      :error="error"
      :empty="hydrated && !isLoading && !error && !project"
      :empty-text="t('projects.empty')"
      @retry="refetch"
    >
      <SharedForbiddenState v-if="!canManage" :description="t('projects.forbidden')" />
      <template v-else-if="project">
        <ProjectSettingsForm :key="project.id" :project="project" />
      </template>
    </SharedPageState>
  </SharedSettingsPage>
</template>
