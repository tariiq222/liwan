<script setup lang="ts">
import { ApiError } from '@/composables/useApi'
import { useProjectSchedule } from '@/composables/useProjectSchedule'
import { useProject } from '@/composables/useProjects'
import ScheduleTaskForm from '@/components/project/schedule/ScheduleTaskForm.vue'
import { safeReturnTo } from '@/utils/safeReturnTo'

const route = useRoute()
const { t } = useI18n()
const projectId = computed(() => { const value = Number(route.params.id); return Number.isInteger(value) && value > 0 ? value : null })
const taskId = computed(() => { const value = Number(route.params.taskId); return Number.isInteger(value) && value > 0 ? value : null })
const { data: schedule, isLoading, error, refetch } = useProjectSchedule(projectId)
const { data: project } = useProject(projectId)
const scheduleLoading = computed(() => isLoading.value && !schedule.value)
const task = computed(() => schedule.value?.tasks.find(item => item.id === taskId.value))
const taskMilestone = computed(() => {
  const milestoneId = task.value?.milestone_id
  return schedule.value?.milestones.find(item => item.id === milestoneId) ?? null
})
const notFound = computed(() => projectId.value === null || taskId.value === null || (error.value instanceof ApiError && [403, 404].includes(error.value.status)) || (!!schedule.value && !task.value))
const returnTo = computed(() => projectId.value ? safeReturnTo(route.query.returnTo, `/projects/${projectId.value}/schedule`, ['/projects']) : '/projects')
</script>

<template>
  <SharedPageContainer width="form">
    <SharedPageHeader :title="t('projects.schedule.editTitle')" :description="t('projects.schedule.editDescription')" :back-to="returnTo" :back-label="t('projects.schedule.backToSchedule')" />
    <SharedPageState
      :loading="scheduleLoading"
      :error="notFound ? null : error"
      :empty="notFound || (!scheduleLoading && !error && (!schedule || !task || !projectId || !schedule.can_manage))"
      :empty-text="notFound ? t('projects.notFound') : !schedule?.can_manage ? t('projects.forbidden') : t('projects.loadError')"
      @retry="refetch"
    >
      <Card v-if="schedule && task && projectId" class="nasq-form"><CardContent><ScheduleTaskForm :project-id="projectId" :task="task" :milestone="taskMilestone" :project-start="project?.date_start" :project-end="project?.date_end" :return-to="returnTo" /></CardContent></Card>
    </SharedPageState>
  </SharedPageContainer>
</template>
