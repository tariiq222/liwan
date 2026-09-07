<script setup lang="ts">
import { ApiError } from '@/composables/useApi'
import { useProject } from '@/composables/useProjects'
import { useProjectSchedule } from '@/composables/useProjectSchedule'
import ScheduleGantt from '@/components/project/schedule/ScheduleGantt.vue'
import type { ScheduleScale } from '@/utils/projectSchedule'

const route = useRoute()
const router = useRouter()
const { t } = useI18n()
const projectId = computed(() => { const value = Number(route.params.id); return Number.isInteger(value) && value > 0 ? value : null })
const isBaseRoute = computed(() => route.path.replace(/\/+$/, '') === `/projects/${route.params.id}/schedule`)
const { data: project, error: projectError } = useProject(projectId)
const { data: schedule, isLoading, error, refetch } = useProjectSchedule(projectId)
const scale = computed<ScheduleScale>({
  get: () => route.query.scale === 'month' ? 'month' : 'week',
  set: value => { void router.replace({ query: { ...route.query, scale: value } }) },
})
const notFound = computed(() => projectId.value === null || (projectError.value instanceof ApiError && [403, 404].includes(projectError.value.status)))
</script>

<template>
  <SharedPageContainer v-if="isBaseRoute" width="list">
    <p v-if="projectId === null || notFound" class="text-muted-foreground">{{ t('projects.notFound') }}</p>
    <p v-else-if="isLoading && !schedule" role="status" class="text-muted-foreground">{{ t('projects.loading') }}</p>
    <div v-else-if="error || !schedule" role="alert">
      <p class="text-destructive">{{ t('projects.loadError') }}</p>
      <Button class="mt-3" type="button" variant="outline" @click="refetch()">{{ t('app.retry') }}</Button>
    </div>
    <ScheduleGantt v-else :schedule="schedule" :scale="scale" :project-start="project?.date_start" :project-end="project?.date_end" @update:scale="scale = $event" />
  </SharedPageContainer>
  <NuxtPage />
</template>
