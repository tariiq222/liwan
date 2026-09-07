<script setup lang="ts">
import { ApiError } from '@/composables/useApi'
import { useProject } from '@/composables/useProjects'
import { useProjectSchedule } from '@/composables/useProjectSchedule'
import ScheduleGantt from '@/components/project/schedule/ScheduleGantt.vue'
import type { ScheduleScale } from '@/utils/projectSchedule'
import { safeReturnTo } from '@/utils/safeReturnTo'

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
const returnTo = computed(() => projectId.value ? safeReturnTo(route.query.returnTo, `/projects/${projectId.value}`, ['/projects']) : '/projects')
</script>

<template>
  <SharedPageContainer v-if="isBaseRoute" width="list">
    <SharedPageHeader
      :title="t('projects.schedule.title')"
      :description="t('projects.schedule.timeline')"
      :back-to="returnTo"
      :back-label="t('projects.backToProject')"
    />
    <SharedPageState
      :loading="isLoading && !schedule"
      :error="projectError || error"
      :empty="projectId === null || notFound || (!isLoading && !schedule && !error)"
      :empty-text="projectId === null || notFound ? t('projects.notFound') : t('projects.schedule.empty')"
      @retry="() => { void refetch() }"
    >
      <ScheduleGantt v-if="schedule" :schedule="schedule" :scale="scale" :project-start="project?.date_start" :project-end="project?.date_end" @update:scale="scale = $event" />
    </SharedPageState>
  </SharedPageContainer>
  <NuxtPage />
</template>
