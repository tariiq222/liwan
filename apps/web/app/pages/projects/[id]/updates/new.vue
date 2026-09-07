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
const { data: project, isLoading, error, refetch } = useProject(projectId)
const notFound = computed(() => projectId.value === null || (error.value instanceof ApiError && [403, 404].includes(error.value.status)))
const returnTo = computed(() => projectId.value ? safeReturnTo(route.query.returnTo, '/projects/' + projectId.value + '?tab=updates', ['/projects']) : '/projects')
</script>

<template>
  <section class="nasq-page-stack">
    <SharedPageHeader :title="t('projects.updates.new')" :description="project?.name" :back-to="returnTo" :back-label="t('projects.backToProject')" />
    <template v-if="projectId === null">
      <p class="text-muted-foreground">{{ t('projects.invalidId') }}</p>
    </template>
    <template v-else-if="isLoading && !project">
      <p role="status" class="text-muted-foreground">{{ t('projects.loading') }}</p>
    </template>
    <template v-else-if="notFound">
      <p class="text-muted-foreground">{{ t('projects.notFound') }}</p>
    </template>
    <SharedPageState v-else-if="error || !project" :error="error" :empty="!error && !project" @retry="refetch" />
    <template v-else-if="!project.can_manage">
      <p class="text-muted-foreground">{{ t('projects.forbidden') }}</p>
    </template>
    <template v-else>
      <Card class="nasq-form"><CardContent><ProjectUpdateForm :project-id="projectId" @saved="router.push(returnTo)" @cancel="router.push(returnTo)" /></CardContent></Card>
    </template>
  </section>
</template>
