<script setup lang="ts">
import { inject } from 'vue'
import { ApiError } from '@/composables/useApi'
import { useProject } from '@/composables/useProjects'
import { useProjectSchedule } from '@/composables/useProjectSchedule'
import ScheduleGantt from '@/components/project/schedule/ScheduleGantt.vue'
import { buildScheduleAxis, scheduleColumnSpan, type ScheduleScale } from '@/utils/projectSchedule'
import { returnToQuery } from '@/utils/safeReturnTo'

const route = useRoute()
const router = useRouter()
const { t, te, locale } = useI18n()
const { can } = useAccess()
const hydrated = useHydrated()
const isProjectOverlay = inject<boolean>(Symbol.for('nasq.project.overlay'), false)
const projectId = computed(() => { const value = Number(route.params.id); return Number.isInteger(value) && value > 0 ? value : null })
const isBaseRoute = computed(() => route.path.replace(/\/+$/, '') === `/projects/${route.params.id}/schedule`)
const { data: projectData, error: projectError, refetch: refetchProject } = useProject(projectId)
const project = computed(() => hydrated.value ? projectData.value : undefined)
const { data: schedule, isLoading, error, refetch } = useProjectSchedule(projectId)
const scale = computed<ScheduleScale>({
  get: () => route.query.scale === 'month' ? 'month' : 'week',
  set: value => { void router.replace({ query: { ...route.query, scale: value } }) },
})
// Same axis inputs as ScheduleGantt, so the label names the columns it draws.
const columnSpanLabel = computed(() => {
  if (!schedule.value) return ''
  const axis = buildScheduleAxis(schedule.value.tasks, schedule.value.milestones, scale.value, {
    start: project.value?.date_start, end: project.value?.date_end,
  })
  const span = scheduleColumnSpan(axis, scale.value, locale.value)
  const key = `projects.schedule.columnSpan.${span.unit}.${span.form}`
  return t(te(key) ? key : `projects.schedule.columnSpan.${span.unit}.other`, { n: span.count })
})
const notFound = computed(() => projectId.value === null || (projectError.value instanceof ApiError && [403, 404].includes(projectError.value.status)))
function retry() { void Promise.all([refetchProject(), refetch()]) }

function openTaskCreate() {
  if (!projectId.value) return
  router.push({ path: `/projects/${projectId.value}/tasks/new`, query: { ...route.query, ...returnToQuery(route.fullPath), tab: 'tasks' } })
}
</script>

<template>
  <SharedPageContainer v-if="isBaseRoute" width="list">
    <SharedPageHeader v-if="!isProjectOverlay" :title="t('projects.schedule.title')">
      <UButton
        v-if="project?.active && can('pmo.tasks.create')"
        icon="i-lucide-plus"
        data-testid="project-header-create"
        :disabled="!hydrated"
        :label="t('tasks.new')"
        @click="openTaskCreate"
      />
    </SharedPageHeader>
    <div class="flex flex-wrap items-center gap-3">
      <nav class="inline-flex items-center gap-0.5 rounded-md p-0.5 ring ring-default bg-default" :aria-label="t('projects.schedule.scale')">
        <UButton type="button" color="neutral" size="sm" :variant="scale === 'week' ? 'soft' : 'ghost'" :disabled="!hydrated" :aria-pressed="scale === 'week'" @click="scale = 'week'">{{ t('projects.schedule.week') }}</UButton>
        <UButton type="button" color="neutral" size="sm" :variant="scale === 'month' ? 'soft' : 'ghost'" :disabled="!hydrated" :aria-pressed="scale === 'month'" @click="scale = 'month'">{{ t('projects.schedule.month') }}</UButton>
      </nav>
      <p v-if="columnSpanLabel" class="text-sm text-muted" data-testid="schedule-column-span" aria-live="polite">{{ columnSpanLabel }}</p>
    </div>
    <SharedPageState
      :loading="isLoading && !schedule"
      :error="projectError || error"
      :empty="projectId === null || notFound || (!isLoading && !schedule && !error)"
      :empty-text="projectId === null || notFound ? t('projects.notFound') : t('projects.schedule.empty')"
      @retry="retry"
    >
      <ScheduleGantt v-if="schedule" embedded :schedule="schedule" :scale="scale" :project-start="project?.date_start" :project-end="project?.date_end" @update:scale="scale = $event" />
    </SharedPageState>
  </SharedPageContainer>
  <NuxtPage />
</template>
