<script setup lang="ts">
import { ApiError } from '@/composables/useApi'
import { useProject } from '@/composables/useProjects'
import ProjectUpdateList from '@/components/project/ProjectUpdateList.vue'
import { returnToQuery } from '@/utils/safeReturnTo'

const route = useRoute()
const { t } = useI18n()
const hydrated = useHydrated()
const projectId = computed(() => {
  const value = Number(route.params.id)
  return Number.isInteger(value) && value > 0 ? value : null
})
const { data: project, isLoading, error, refetch } = useProject(projectId)
const notFound = computed(() => projectId.value === null || (error.value instanceof ApiError && [403, 404].includes(error.value.status)))
const normalizedPath = computed(() => route.path.replace(/\/+$/, '') || '/')
const isListRoute = computed(() => {
  const rest = normalizedPath.value.replace(/^\/projects\/[^/]+\/updates/, '')
  return rest === '' || rest === '/new'
})

const createTo = computed(() => project.value?.can_manage && project.value.active ? { path: `/projects/${projectId.value}/updates/new`, query: returnToQuery(route.fullPath) } : undefined)
</script>

<template>
  <SharedListPage
    v-if="isListRoute"
    hide-header
    :title="t('projects.refresh.workspace.updatesTitle')"
    :create-to="createTo"
    :create-label="t('projects.updates.new')"
    create-test-id="project-updates-create"
  >
    <SharedPageState
      :loading="isLoading && !project"
      :error="notFound ? null : error"
      :empty="notFound || (!isLoading && !error && !project)"
      :empty-text="notFound ? t('projects.notFound') : t('projects.empty')"
      @retry="refetch"
    >
      <ProjectUpdateList v-if="project" :project-id="project.id" :can-manage="project.can_manage" />
    </SharedPageState>
  </SharedListPage>
  <NuxtPage />
</template>
