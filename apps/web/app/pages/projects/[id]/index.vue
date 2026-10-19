<script setup lang="ts">
import { projectRecordBack } from '@/utils/projectNavigation'
import ProjectPhaseGate from '@/components/pmo/projects/ProjectPhaseGate.vue'
import ProjectOverview from '@/components/pmo/projects/ProjectOverview.vue'
import { ApiError } from '@/composables/useApi'
import { projectIdFromPath } from '@/modules/pmo/projectRoutes'
import { useProject, useProjectList } from '@/composables/useProjects'
import { canCopyProject } from '@/utils/projectCopyAccess'
import { returnToQuery } from '@webvue/ui/app/utils/safeReturnTo'

const route = useRoute()
const router = useRouter()
const { t } = useI18n()
const hydrated = useHydrated()
const { can } = useAccess()
const projectId = computed(() => projectIdFromPath(route.path))
const sourcePaths = useProjectRecordListPaths(projectId, ['/projects', '/projects/dashboard'])
const { data: projectData, isLoading, error, refetch } = useProject(projectId)
// Same SSR contract as the frame: reveal the cached project only once hydrated.
const project = computed(() => hydrated.value ? projectData.value : undefined)
const notFound = computed(() => projectId.value === null || (error.value instanceof ApiError && (error.value.status === 404 || error.value.status === 403)))
const projectReturnTo = computed(() => router.resolve(projectRecordBack(route.query, projectId.value, sourcePaths.value, route.hash)).fullPath)
// The first client render must match SSR, which has no project yet: loading until hydrated.
const loading = computed(() => !project.value && !error.value && (isLoading.value || !hydrated.value))
// Copying needs the server's create signal (the same one the projects list uses) and the right to read
// the tasks that get copied. A one-row list query carries that signal.
const { data: createSignal } = useProjectList(ref(false), { limit: 1 })
const canCopy = computed(() => canCopyProject(Boolean(project.value), createSignal.value?.can_create, can('pmo.tasks.read')))
const copyTo = computed(() => ({
  path: '/projects/new',
  query: { copyFrom: String(projectId.value), ...returnToQuery(route.fullPath) },
}))
</script>

<template>
  <SharedPageContainer v-if="notFound" width="list">
    <div class="flex flex-col items-start gap-(--webvue-gap-card)">
      <p class="text-muted">{{ t('projects.notFound') }}</p>
      <UButton type="button" color="neutral" variant="outline" size="sm" @click="router.push(projectReturnTo)">{{ t('projects.backToProjects') }}</UButton>
    </div>
  </SharedPageContainer>
  <!-- The workspace frame above is this page's h1, so hide-header draws no heading here. The title still
       names the page for the shell. The frame and its tabs span the full list width, so the record is full width
       too and the summary tiles line up with the tab strip. -->
  <SharedRecordPage :keep-content="!!project" v-else hide-header width="full" :title="t('nav.projectSummary')" :loading="loading" :error="error" @retry="refetch">
    <template v-if="canCopy" #actions>
      <UButton color="neutral" variant="outline" icon="i-lucide-copy" :to="copyTo" data-testid="project-copy-link" :label="t('projects.copy.action')" />
    </template>
    <div v-if="project" class="flex flex-col gap-(--webvue-gap-card)">
      <ProjectPhaseGate :project="project" />
      <ProjectOverview :project="project" />
    </div>
  </SharedRecordPage>
</template>
