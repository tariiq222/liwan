<script setup lang="ts">
import { ApiError } from '@/composables/useApi'
import { useProject } from '@/composables/useProjects'
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
  <SharedSettingsPage width="list">
    <SharedPageHeader
      :title="t('projects.settings.title')"
    />
    <template v-if="projectId === null">
      <p class="text-muted">{{ t('projects.invalidId') }}</p>
    </template>
    <SharedPageState
      v-else
      :loading="!project && !error && (isLoading || !hydrated)"
      :error="notFound ? null : error"
      :empty="notFound || (hydrated && !isLoading && !error && !project)"
      :empty-text="t('projects.notFound')"
      @retry="refetch"
    >
      <p v-if="!canManage" class="text-muted">{{ t('projects.forbidden') }}</p>
      <template v-else-if="project">
        <ProjectSettingsForm :key="project.id" :project="project" />
      </template>
    </SharedPageState>
  </SharedSettingsPage>
</template>
