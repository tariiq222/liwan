<script setup lang="ts">
import ProjectUpdateForm from '@/components/project/ProjectUpdateForm.vue'
import { ApiError } from '@/composables/useApi'
import { useProject } from '@/composables/useProjects'
import { safeReturnTo } from '@/utils/safeReturnTo'

const route = useRoute()
const router = useRouter()
const { t } = useI18n()
const projectId = computed(() => {
  const n = Number(route.params.id)
  return Number.isInteger(n) && n > 0 ? n : null
})
const { data: project, isLoading, error } = useProject(projectId)
const notFound = computed(() => projectId.value === null || (error.value instanceof ApiError && [403, 404].includes(error.value.status)))
const returnTo = computed(() => projectId.value ? safeReturnTo(route.query.returnTo, '/projects/' + projectId.value + '?tab=updates', ['/projects']) : '/projects')
</script>

<template>
  <section class="mx-auto w-full max-w-2xl space-y-6">
    <nav><button type="button" class="text-sm text-muted-foreground hover:underline" @click="router.push(returnTo)">{{ t('projects.backToProject') }}</button></nav>
    <template v-if="projectId === null">
      <h1 class="text-2xl font-semibold">{{ t('projects.updates.new') }}</h1>
      <p class="text-muted-foreground">{{ t('projects.invalidId') }}</p>
    </template>
    <template v-else-if="isLoading && !project">
      <h1 class="text-2xl font-semibold">{{ t('projects.updates.new') }}</h1>
      <p role="status" class="text-muted-foreground">{{ t('projects.loading') }}</p>
    </template>
    <template v-else-if="notFound">
      <h1 class="text-2xl font-semibold">{{ t('projects.updates.new') }}</h1>
      <p class="text-muted-foreground">{{ t('projects.notFound') }}</p>
    </template>
    <template v-else-if="error || !project">
      <h1 class="text-2xl font-semibold">{{ t('projects.updates.new') }}</h1>
      <p role="alert" class="text-destructive">{{ t('projects.loadError') }}</p>
    </template>
    <template v-else-if="!project.can_manage">
      <h1 class="text-2xl font-semibold">{{ t('projects.updates.new') }}</h1>
      <p class="text-muted-foreground">{{ t('projects.forbidden') }}</p>
    </template>
    <template v-else>
      <header><h1 class="text-2xl font-semibold">{{ t('projects.updates.new') }}</h1><p class="mt-1 text-muted-foreground">{{ project.name }}</p></header>
      <Card><CardContent class="pt-6"><ProjectUpdateForm :project-id="projectId" @saved="router.push(returnTo)" @cancel="router.push(returnTo)" /></CardContent></Card>
    </template>
  </section>
</template>
