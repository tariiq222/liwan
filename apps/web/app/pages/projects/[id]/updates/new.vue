<script setup lang="ts">
import ProjectUpdateForm from '@/components/pmo/projects/ProjectUpdateForm.vue'
import { ApiError } from '@/composables/useApi'
import { useProject } from '@/composables/useProjects'

const route = useRoute()
const router = useRouter()
const { t } = useI18n()
const projectId = computed(() => {
  const n = Number(route.params.id)
  return Number.isInteger(n) && n > 0 ? n : null
})
const { data: project, isLoading, error, refetch } = useProject(projectId)
const notFound = computed(() => projectId.value === null || (error.value instanceof ApiError && [403, 404].includes(error.value.status)))
// The owning section list is fixed by this page's own route, so the return trip
// is literal and carries only the state that list was showing. A referrer's
// returnTo is dropped rather than forwarded: on the list URL it would nest one
// level deeper on every round trip and redirect that page's own controls.
const backTo = computed(() => {
  const { returnTo: _referrer, ...listQuery } = route.query
  return { path: `/projects/${projectId.value}/updates`, query: listQuery }
})
</script>

<template>
  <SharedCreatePanel :title="t('projects.updates.new')" :back-to="backTo">
    <template v-if="projectId === null">
      <p class="text-muted">{{ t('projects.invalidId') }}</p>
    </template>
    <SharedPageState
      v-else
      :loading="isLoading && !project"
      :error="notFound ? null : error"
      :empty="notFound || (!isLoading && !error && !project)"
      :empty-text="notFound ? t('projects.notFound') : t('projects.empty')"
      @retry="refetch"
    >
      <p v-if="!project?.can_manage" class="text-muted">{{ t('projects.forbidden') }}</p>
      <ProjectUpdateForm v-else :project-id="projectId" @saved="router.push(backTo)" @cancel="router.push(backTo)" />
    </SharedPageState>
  </SharedCreatePanel>
</template>
