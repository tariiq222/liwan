<script setup lang="ts">
import ProjectOverview from '@/components/pmo/projects/ProjectOverview.vue'
import { projectIdFromPath } from '@/modules/pmo/projectRoutes'
import { useProject } from '@/composables/useProjects'

// Updates have no page of their own: `/projects/:id/updates` redirects to the summary, which lists them. This route stays
// only as the parent of the create form (`/updates/new`), so its panel opens over the summary like any create panel over its context.
const route = useRoute()
const { t } = useI18n()
const hydrated = useHydrated()
const projectId = computed(() => projectIdFromPath(route.path))
const { data: projectData, isLoading } = useProject(projectId)
const project = computed(() => hydrated.value ? projectData.value : undefined)
</script>

<template>
  <!-- One root element: this route replaces the summary route, and a page transition cannot animate a fragment. -->
  <div class="contents">
    <SharedRecordPage hide-header keep-content :title="t('nav.projectSummary')" :loading="!project && (isLoading || !hydrated)">
      <ProjectOverview v-if="project" :project="project" />
    </SharedRecordPage>
    <NuxtPage />
  </div>
</template>
