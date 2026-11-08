<script setup lang="ts">
import { projectRecordBack } from '@/utils/projectNavigation'
import ProjectNotFoundState from '@/components/pmo/projects/ProjectNotFoundState.vue'
import ProjectOverview from '@/components/pmo/projects/ProjectOverview.vue'
import { ApiError } from '@/composables/useApi'
import { projectIdFromPath } from '@/modules/pmo/projectRoutes'
import { useProject } from '@/composables/useProjects'

const route = useRoute()
const router = useRouter()
const { t } = useI18n()
const hydrated = useHydrated()
const projectId = computed(() => projectIdFromPath(route.path))
const sourcePaths = useProjectRecordListPaths(projectId, ['/projects', '/projects/dashboard'])
const { data: projectData, isLoading, error, refetch } = useProject(projectId)
// Same SSR contract as the frame: reveal the cached project only once hydrated.
const project = computed(() => hydrated.value ? projectData.value : undefined)
const notFound = computed(() => projectId.value === null || (error.value instanceof ApiError && (error.value.status === 404 || error.value.status === 403)))
const projectReturnTo = computed(() => router.resolve(projectRecordBack(route.query, projectId.value, sourcePaths.value, route.hash)).fullPath)
// The first client render must match SSR, which has no project yet: loading until hydrated.
const loading = computed(() => !project.value && !error.value && (isLoading.value || !hydrated.value))
// The workspace frame above is this page's h1, so hide-header draws no heading here. The title still names the page for the shell;
// the frame's header draws the page's actions (a new task, copy). The frame and its tabs span the full list width, so the record is
// full width too and the summary tiles line up with the tab strip. (Not a template comment: in development it would make a second root node.)
</script>

<template>
  <ProjectNotFoundState v-if="notFound" :back-to="projectReturnTo" />
  <SharedRecordPage :keep-content="!!project" v-else hide-header :title="t('nav.projectSummary')" :loading="loading" :error="error" @retry="refetch">
    <div v-if="project" class="flex flex-col gap-(--liwan-gap-card)">
      <ProjectOverview :project="project" />
    </div>
  </SharedRecordPage>
</template>
