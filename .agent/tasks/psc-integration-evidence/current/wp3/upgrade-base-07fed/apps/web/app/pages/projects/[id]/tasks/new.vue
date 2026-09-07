<script setup lang="ts">
import { toast } from 'vue-sonner'
import TaskCreateForm from '@/components/task/TaskCreateForm.vue'
import { ApiError } from '@/composables/useApi'
import { useProject } from '@/composables/useProjects'
import { returnToQuery, safeReturnTo } from '@/utils/safeReturnTo'

const route = useRoute()
const router = useRouter()
const { t } = useI18n()
const hydrated = useHydrated()
const projectId = computed(() => {
  const n = Number(route.params.id)
  return Number.isInteger(n) && n > 0 ? n : null
})
const { data: project, isLoading, error } = useProject(projectId)
const notFound = computed(() => projectId.value === null || (error.value instanceof ApiError && [403, 404].includes(error.value.status)))
const returnTo = computed(() => projectId.value ? safeReturnTo(route.query.returnTo, '/projects/' + projectId.value + '?tab=tasks', ['/projects']) : '/projects')
function created(id: number) {
  toast.success(t('tasks.created'))
  router.push({ path: '/projects/' + projectId.value + '/tasks/' + id, query: returnToQuery(returnTo.value) })
}
</script>

<template>
  <section class="nasq-page-stack">
    <SharedPageHeader :title="t('tasks.new')" :description="project?.name" :back-to="returnTo" :back-label="t('projects.backToProject')" />
    <template v-if="projectId === null">
      <p class="text-muted-foreground">{{ t('tasks.invalidId') }}</p>
    </template>
    <template v-else-if="isLoading && !project">
      <p role="status" class="text-muted-foreground">{{ t('tasks.loading') }}</p>
    </template>
    <template v-else-if="notFound">
      <p class="text-muted-foreground">{{ t('tasks.notFound') }}</p>
    </template>
    <template v-else-if="error || !project">
      <p role="alert" class="text-destructive">{{ t('tasks.loadError') }}</p>
    </template>
    <template v-else>
      <Card class="nasq-form"><CardContent><TaskCreateForm :project-id="projectId" @created="created" @cancel="router.push(returnTo)" /></CardContent></Card>
    </template>
    <p v-if="!hydrated" class="sr-only">{{ t('tasks.loading') }}</p>
  </section>
</template>
