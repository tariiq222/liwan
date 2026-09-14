<script setup lang="ts">
import { inject } from 'vue'
import { ApiError } from '@/composables/useApi'
import { useProject } from '@/composables/useProjects'
import ProjectUpdateList from '@/components/project/ProjectUpdateList.vue'
import { returnToQuery } from '@/utils/safeReturnTo'

const route = useRoute()
const router = useRouter()
const { t } = useI18n()
const hydrated = useHydrated()
const isProjectOverlay = inject<boolean>(Symbol.for('nasq.project.overlay'), false)
const projectId = computed(() => {
  const value = Number(route.params.id)
  return Number.isInteger(value) && value > 0 ? value : null
})
const { data: project, isLoading, error, refetch } = useProject(projectId)
const notFound = computed(() => projectId.value === null || (error.value instanceof ApiError && [403, 404].includes(error.value.status)))

function openCreate() {
  if (!projectId.value || !project.value?.can_manage || !hydrated.value) return
  router.push({ path: `/projects/${projectId.value}/updates/new`, query: returnToQuery(route.fullPath) })
}
</script>

<template>
  <SharedPageContainer v-if="route.path.replace(/\/+$/, '') === `/projects/${projectId}/updates`" width="list">
    <SharedPageHeader
      v-if="!isProjectOverlay"
      :title="t('projects.refresh.workspace.updatesTitle')"
      :description="t('projects.updates.emptyHint')"
    >
      <template #actions>
        <UButton v-if="project?.can_manage" data-testid="project-updates-create" icon="i-lucide-plus" :disabled="!hydrated" @click="openCreate">
          {{ t('projects.updates.new') }}
        </UButton>
      </template>
    </SharedPageHeader>
    <SharedPageState
      :loading="isLoading && !project"
      :error="notFound ? null : error"
      :empty="notFound || (!isLoading && !error && !project)"
      :empty-text="notFound ? t('projects.notFound') : t('projects.empty')"
      @retry="refetch"
    >
      <ProjectUpdateList v-if="project" :project-id="project.id" :can-manage="project.can_manage" :show-create="false" />
    </SharedPageState>
  </SharedPageContainer>
</template>
