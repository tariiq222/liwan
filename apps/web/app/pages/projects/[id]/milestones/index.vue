<script setup lang="ts">
import MilestoneTable from '@/components/project/MilestoneTable.vue'
import { ApiError } from '@/composables/useApi'
import { projectIdFromPath } from '@/composables/nav/activeRoute'
import { useProject } from '@/composables/useProjects'
import { safeReturnTo } from '@/utils/safeReturnTo'

const route = useRoute()
const router = useRouter()
const { t } = useI18n()
const hydrated = useHydrated()
const projectId = computed(() => projectIdFromPath(route.path))
const { data: projectData, isLoading, error, refetch } = useProject(projectId)
// Same SSR contract as the frame: reveal the cached project only once hydrated.
const project = computed(() => hydrated.value ? projectData.value : undefined)
const notFound = computed(() => projectId.value === null || (error.value instanceof ApiError && (error.value.status === 404 || error.value.status === 403)))
const projectReturnTo = computed(() => safeReturnTo(route.query.returnTo, '/projects', ['/projects', '/tasks', '/hr', '/settings', '/account', '/search', '/notifications', '/reports']))
const canCreate = computed(() => project.value?.can_manage === true && project.value.active)

// The frame renders the project name as the page's only h1, so this page
// registers the shell title without emitting a competing heading.
usePageHeader(() => t('projects.tabs.milestones'))

function openCreate() {
  router.push(`/projects/${projectId.value}/milestones/new`)
}
</script>

<template>
  <SharedPageContainer width="list">
    <div v-if="notFound" class="flex flex-col items-start gap-3">
      <p class="text-muted">{{ t('projects.notFound') }}</p>
      <UButton type="button" color="neutral" variant="outline" size="sm" @click="router.push(projectReturnTo)">{{ t('projects.backToProjects') }}</UButton>
    </div>

    <SharedPageState v-else-if="error" :error="error" @retry="refetch" />
    <template v-else>
      <div v-if="canCreate" class="flex justify-end">
        <UButton
          icon="i-lucide-plus"
          data-testid="project-header-create"
          :disabled="!hydrated"
          :label="t('projects.milestones.new')"
          @click="openCreate"
        />
      </div>
      <MilestoneTable v-if="project" :project-id="project.id" :can-manage="project.can_manage" embedded />
      <!-- The frame above already shows the loading identity; this stands in
           for the table body, not for a heading this page does not have. -->
      <USkeleton v-else-if="isLoading || !hydrated" class="h-40 w-full" />
    </template>
  </SharedPageContainer>
</template>
