<script setup lang="ts">
import TaskCreateForm from '@/components/task/TaskCreateForm.vue'
import { ApiError } from '@/composables/useApi'
import { useProject } from '@/composables/useProjects'

const route = useRoute()
const router = useRouter()
const { t } = useI18n()
const toast = useToast()
const hydrated = useHydrated()
const projectId = computed(() => {
  const n = Number(route.params.id)
  return Number.isInteger(n) && n > 0 ? n : null
})
const milestoneId = computed(() => {
  const n = Number(route.query.milestone_id)
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
  return { path: `/projects/${projectId.value}/tasks`, query: listQuery }
})
function created(_id: number) {
  toast.add({ title: t('tasks.created'), color: 'success', icon: 'i-lucide-circle-check' })
  router.push(backTo.value)
}
</script>

<template>
  <SharedPageContainer width="form">
    <SharedPageHeader :title="t('tasks.new')" :back-to="backTo" :back-label="t('projects.backToProject')" />
    <template v-if="projectId === null">
      <p class="text-muted">{{ t('tasks.invalidId') }}</p>
    </template>
    <SharedPageState
      v-else
      :loading="isLoading && !project"
      :error="notFound ? null : error"
      :empty="notFound || (!isLoading && !error && !project)"
      :empty-text="t('tasks.notFound')"
      @retry="refetch"
    >
      <section class="nasq-ui-record-surface"><div class="p-5"><TaskCreateForm mode="project" :project-id="projectId" :milestone-id="milestoneId" :project-start="project?.date_start" :project-end="project?.date_end" :can-manage="project?.can_manage" @created="created" @cancel="router.push(backTo)" /></div></section>
    </SharedPageState>
    <p v-if="!hydrated" class="sr-only">{{ t('tasks.loading') }}</p>
  </SharedPageContainer>
</template>
