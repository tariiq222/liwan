<script setup lang="ts">
import { ApiError } from '@/composables/useApi'
import { useProject } from '@/composables/useProjects'
import ProjectUpdateList from '@/components/project/ProjectUpdateList.vue'
import { returnToQuery } from '@/utils/safeReturnTo'

const route = useRoute()
const router = useRouter()
const { t } = useI18n()
const hydrated = useHydrated()
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
  <SharedPageContainer v-if="route.path.replace(/\/+$/, '') === `/projects/${projectId}/updates`" width="detail">
    <SharedPageHeader
      :title="t('projects.refresh.workspace.updatesTitle')"
    >
      <template #actions>
        <Button v-if="project?.can_manage" data-testid="project-updates-create" :disabled="!hydrated" @click="openCreate">
          {{ t('projects.updates.new') }}
        </Button>
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
