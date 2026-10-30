<script setup lang="ts">
import MilestoneTable from '@/components/pmo/projects/MilestoneTable.vue'
import ProjectNotFoundState from '@/components/pmo/projects/ProjectNotFoundState.vue'
import { ApiError } from '@/composables/useApi'
import { projectIdFromPath } from '@/modules/pmo/projectRoutes'
import { useProject } from '@/composables/useProjects'
import { returnToQuery, safeReturnTo } from '@liwan/ui/app/utils/safeReturnTo'

const route = useRoute()
const { t } = useI18n()
const hydrated = useHydrated()
const projectId = computed(() => projectIdFromPath(route.path))
const { data: projectData, isLoading, error, refetch } = useProject(projectId)
// Same SSR contract as the frame: reveal the cached project only once hydrated.
const project = computed(() => hydrated.value ? projectData.value : undefined)
const notFound = computed(() => projectId.value === null || (error.value instanceof ApiError && (error.value.status === 404 || error.value.status === 403)))
const projectReturnTo = computed(() => safeReturnTo(route.query.returnTo, '/projects', ['/projects', '/tasks', '/hr', '/settings', '/account', '/search', '/notifications', '/reports']))
const canCreate = computed(() => project.value?.can_manage === true && project.value.active)
const normalizedPath = computed(() => route.path.replace(/\/+$/, '') || '/')
const isListRoute = computed(() => {
  const rest = normalizedPath.value.replace(/^\/projects\/[^/]+\/milestones/, '')
  return rest === '' || rest === '/new'
})

const createTo = computed(() => ({ path: `/projects/${projectId.value}/milestones/new`, query: returnToQuery(route.fullPath) }))
</script>

<template>
  <template v-if="isListRoute">
    <SharedPageContainer v-if="notFound || error" width="list">
      <ProjectNotFoundState v-if="notFound" embedded :back-to="projectReturnTo" />
      <SharedPageState v-else :error="error" @retry="refetch" />
    </SharedPageContainer>
    <!-- The frame is this page's h1: hide-header draws no heading, the create button stays in the header row. -->
    <SharedListPage
      v-else
      hide-header
      :title="t('projects.tabs.milestones')"
      :create-to="canCreate ? createTo : undefined"
      :create-label="t('projects.milestones.new')"
      create-test-id="project-header-create"
    >
      <MilestoneTable v-if="project" :project-id="project.id" :can-manage="project.can_manage && project.active" />
      <SharedLoadingSkeleton v-else-if="isLoading || !hydrated" />
    </SharedListPage>
  </template>
  <NuxtPage />
</template>
