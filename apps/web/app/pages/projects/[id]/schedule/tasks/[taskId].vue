<script setup lang="ts">
import { ApiError } from '@/composables/useApi'
import { useProjectSchedule } from '@/composables/useProjectSchedule'
import { useProject } from '@/composables/useProjects'
import ScheduleTaskForm from '@/components/project/schedule/ScheduleTaskForm.vue'

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
// The owning section list is fixed by this page's own route, so the return trip
// is literal and carries only the state that list was showing. A referrer's
// returnTo is dropped rather than forwarded: on the list URL it would nest one
// level deeper on every round trip and redirect that page's own controls.
const backTo = computed(() => {
  const { returnTo: _referrer, ...listQuery } = route.query
  return { path: `/projects/${projectId.value}/schedule`, query: listQuery }
})
</script>

<template>
  <SharedPageContainer width="form">
    <SharedPageHeader :title="t('projects.schedule.editTitle')" :back-to="backTo" :back-label="t('projects.schedule.backToSchedule')" />
    <SharedPageState
      :loading="scheduleLoading"
      :error="notFound ? null : error"
      :empty="notFound || (!scheduleLoading && !error && (!schedule || !task || !projectId || !schedule.can_manage))"
      :empty-text="notFound ? t('projects.notFound') : !schedule?.can_manage ? t('projects.forbidden') : t('projects.loadError')"
      @retry="refetch"
    >
      <SharedFormSection v-if="schedule && task && projectId" panel><ScheduleTaskForm :project-id="projectId" :task="task" :milestone="taskMilestone" :project-start="project?.date_start" :project-end="project?.date_end" :return-to="backTo" /></SharedFormSection>
    </SharedPageState>
  </SharedPageContainer>
</template>
