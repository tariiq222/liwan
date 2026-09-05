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
const returnTo = computed(() => projectId.value ? safeReturnTo(route.query.returnTo, '/projects/' + projectId.value + '?tab=list', ['/projects']) : '/projects')
function created(id: number) {
  toast.success(t('tasks.created'))
  router.push({ path: '/projects/' + projectId.value + '/tasks/' + id, query: returnToQuery(returnTo.value) })
}
</script>

<template>
  <section class="mx-auto w-full max-w-2xl space-y-6">
    <nav><button type="button" class="text-sm text-muted-foreground hover:underline" @click="router.push(returnTo)">{{ t('projects.backToProject') }}</button></nav>
    <template v-if="projectId === null">
      <h1 class="text-2xl font-semibold">{{ t('tasks.new') }}</h1>
      <p class="text-muted-foreground">{{ t('tasks.invalidId') }}</p>
    </template>
    <template v-else-if="isLoading && !project">
      <h1 class="text-2xl font-semibold">{{ t('tasks.new') }}</h1>
      <p role="status" class="text-muted-foreground">{{ t('tasks.loading') }}</p>
    </template>
    <template v-else-if="notFound">
      <h1 class="text-2xl font-semibold">{{ t('tasks.new') }}</h1>
      <p class="text-muted-foreground">{{ t('tasks.notFound') }}</p>
    </template>
    <template v-else-if="error || !project">
      <h1 class="text-2xl font-semibold">{{ t('tasks.new') }}</h1>
      <p role="alert" class="text-destructive">{{ t('tasks.loadError') }}</p>
    </template>
    <template v-else>
      <header><h1 class="text-2xl font-semibold">{{ t('tasks.new') }}</h1><p class="mt-1 text-muted-foreground">{{ project.name }}</p></header>
      <Card><CardContent class="pt-6"><TaskCreateForm :project-id="projectId" @created="created" @cancel="router.push(returnTo)" /></CardContent></Card>
    </template>
    <p v-if="!hydrated" class="sr-only">{{ t('tasks.loading') }}</p>
  </section>
</template>
