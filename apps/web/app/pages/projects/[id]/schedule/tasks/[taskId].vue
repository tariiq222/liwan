<script setup lang="ts">
import { ApiError } from '@/composables/useApi'
import { useProjectSchedule } from '@/composables/useProjectSchedule'
import ScheduleTaskForm from '@/components/project/schedule/ScheduleTaskForm.vue'
import { safeReturnTo } from '@/utils/safeReturnTo'

const route = useRoute()
const { t } = useI18n()
const projectId = computed(() => { const value = Number(route.params.id); return Number.isInteger(value) && value > 0 ? value : null })
const taskId = computed(() => { const value = Number(route.params.taskId); return Number.isInteger(value) && value > 0 ? value : null })
const { data: schedule, isLoading, error } = useProjectSchedule(projectId)
const task = computed(() => schedule.value?.tasks.find(item => item.id === taskId.value))
const notFound = computed(() => projectId.value === null || taskId.value === null || (error.value instanceof ApiError && [403, 404].includes(error.value.status)) || (!!schedule.value && !task.value))
const returnTo = computed(() => projectId.value ? safeReturnTo(route.query.returnTo, `/projects/${projectId.value}/schedule`, ['/projects']) : '/projects')
</script>

<template>
  <section class="nasq-page-stack mx-auto w-full max-w-2xl">
    <SharedPageHeader :title="t('projects.schedule.editTitle')" :back-to="returnTo" :back-label="t('projects.schedule.backToSchedule')" />
    <p v-if="notFound" class="text-muted-foreground">{{ t('projects.notFound') }}</p>
    <p v-else-if="isLoading && !schedule" role="status" class="text-muted-foreground">{{ t('projects.loading') }}</p>
    <p v-else-if="error || !task || !projectId" role="alert" class="text-destructive">{{ t('projects.loadError') }}</p>
    <p v-else-if="!schedule.can_manage" class="text-muted-foreground">{{ t('projects.forbidden') }}</p>
    <Card v-else class="nasq-form"><CardContent><ScheduleTaskForm :project-id="projectId" :task="task" :return-to="returnTo" /></CardContent></Card>
  </section>
</template>
