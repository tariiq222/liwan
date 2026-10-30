<script setup lang="ts">
import { ApiError } from '@/composables/useApi'
import { useProjectSchedule } from '@/composables/useProjectSchedule'
import { useProject } from '@/composables/useProjects'
import { formatCalendarDate } from '@liwan/ui/app/composables/calendarDate'
import ScheduleTaskForm from './ScheduleTaskForm.vue'

const props = defineProps<{ projectId: number; taskId: number }>()
const { t, locale } = useI18n()
const hydrated = useHydrated()
const projectId = computed(() => props.projectId)
const schedule = useProjectSchedule(projectId)
const project = useProject(projectId)
const editing = ref(false)
watch([() => props.projectId, () => props.taskId], () => { editing.value = false }, { flush: 'sync' })
const denied = computed(() => [schedule.error.value, project.error.value].some(cause => cause instanceof ApiError && [403, 404].includes(cause.status)))
const task = computed(() => denied.value ? undefined : schedule.data.value?.tasks.find(item => item.id === props.taskId))
const milestone = computed(() => schedule.data.value?.milestones.find(item => item.id === task.value?.milestone_id))
const canManage = computed(() => !denied.value && schedule.data.value?.can_manage === true && project.data.value?.active === true)
</script>

<template>
  <SharedRecordSection id="schedule" variant="panel" data-testid="project-task-schedule-section" :title="t('projects.schedule.title')" :description="t('projects.schedule.taskSectionHint')">
    <template v-if="canManage && task && !editing" #actions>
      <UButton data-testid="project-task-schedule-edit" color="neutral" variant="outline" :disabled="!hydrated" @click="editing = true">{{ t('projects.schedule.editTitle') }}</UButton>
    </template>
    <SharedPageState :loading="!task && (schedule.isLoading.value || project.isLoading.value)" :error="schedule.error.value || project.error.value" :empty="!task && !schedule.isLoading.value && !schedule.error.value" :empty-text="t('projects.schedule.unavailable')" @retry="() => { schedule.refetch(); project.refetch() }">
      <dl v-if="task && !editing" class="grid gap-4 sm:grid-cols-2">
        <div><dt class="text-sm text-muted">{{ t('projects.schedule.start') }}</dt><dd class="mt-1"><bdi>{{ formatCalendarDate(task.start, locale) || '—' }}</bdi></dd></div>
        <div><dt class="text-sm text-muted">{{ t('projects.schedule.end') }}</dt><dd class="mt-1"><bdi>{{ formatCalendarDate(task.end, locale) || '—' }}</bdi></dd></div>
      </dl>
    </SharedPageState>
    <ScheduleTaskForm v-if="editing && task" :key="`${projectId}:${task.id}`" :project-id="projectId" :task="task" :can-write="canManage" :milestone="milestone" :project-start="project.data.value?.date_start" :project-end="project.data.value?.date_end" @saved="editing = false" @cancel="editing = false" />
  </SharedRecordSection>
</template>
