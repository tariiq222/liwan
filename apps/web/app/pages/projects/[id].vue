<script setup lang="ts">
import ProjectStatusBadge from '@/components/project/ProjectStatusBadge.vue'
import ProjectWorkspaceTabs from '@/components/project/workspace/ProjectWorkspaceTabs.vue'
import { ApiError } from '@/composables/useApi'
import { activeProjectSection, projectIdFromPath } from '@/composables/nav/activeRoute'
import { useProject } from '@/composables/useProjects'

const route = useRoute()
const { t } = useI18n()
const hydrated = useHydrated()
const projectId = computed(() => projectIdFromPath(route.path))
const { data: projectData, isLoading, error } = useProject(projectId)
// Queries may finish after server rendering but before payload dehydration.
// Keep the first client tree identical to SSR, then reveal the cached project.
const project = computed(() => hydrated.value ? projectData.value : undefined)
const notFound = computed(() => projectId.value === null || (error.value instanceof ApiError && (error.value.status === 404 || error.value.status === 403)))
const settingsTo = computed(() => `/projects/${projectId.value}/settings`)
// Settings is deliberately not one of the seven sections (activeProjectSection
// returns null for it, and the tab strip must not grow an eighth tab), but it
// is still a page of this workspace: without the frame it would lose the
// project identity and every route back to the project.
const isProjectSettings = computed(() => projectId.value !== null
  && (route.path.replace(/\/+$/, '') || '/') === settingsTo.value)
// The frame belongs to the seven sections and their records, plus settings. A
// failed load with nothing cached has no identity to show, so the child page's
// error state stands alone. `projectData` rather than `project` here: gating on
// the hydration-delayed value would make the first client render drop a frame
// the server had already emitted.
const showFrame = computed(() => !notFound.value
  && !(error.value && !projectData.value)
  && (activeProjectSection(route.path) !== null || isProjectSettings.value))
</script>

<template>
  <div class="flex flex-col gap-6">
    <SharedPageContainer v-if="showFrame" width="list" data-testid="project-workspace-frame">
      <div class="flex flex-col gap-4">
        <div class="flex min-h-9 flex-wrap items-start justify-between gap-3" data-testid="project-workspace-identity">
          <div v-if="project" class="min-w-0">
            <h1 class="truncate text-xl font-semibold text-highlighted" data-testid="project-workspace-name">{{ project.name }}</h1>
            <p class="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted">
              <ProjectStatusBadge :status="project.status" />
              <span v-if="project.manager" class="inline-flex items-center gap-1.5">
                <UIcon name="i-lucide-user-round" class="size-4" aria-hidden="true" />
                <span class="sr-only">{{ t('projects.columns.manager') }}: </span>{{ project.manager.name }}
              </span>
            </p>
          </div>
          <USkeleton v-else-if="isLoading || !hydrated" class="h-9 w-1/3" />
          <UButton
            v-if="project?.can_manage"
            square
            color="neutral"
            variant="outline"
            icon="i-lucide-settings"
            class="ms-auto"
            data-testid="project-workspace-settings"
            :to="settingsTo"
            :aria-label="t('nav.projectSettings')"
            :title="t('nav.projectSettings')"
            :aria-current="isProjectSettings ? 'page' : undefined"
          />
        </div>
        <!-- Tabs follow the hydrated project like the title row, so a first click is a client-side navigation. -->
        <ProjectWorkspaceTabs v-if="project" :project-id="projectId!" :active="project.active" />
        <USkeleton v-else-if="isLoading || !hydrated" class="h-8 w-2/3" />
      </div>
    </SharedPageContainer>
    <NuxtPage />
  </div>
</template>
