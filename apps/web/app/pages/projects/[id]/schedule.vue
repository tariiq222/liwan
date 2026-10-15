<script setup lang="ts">
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
  const label = t(te(key) ? key : `projects.schedule.columnSpan.${span.unit}.other`, { n: span.count })
  // Columns are grouped once the axis unit exceeds one nominal week or month.
  return axis.unitDays > (scale.value === 'month' ? 30 : 7) ? t('projects.schedule.columnSpanGrouped', { span: label }) : label
})
const notFound = computed(() => projectId.value === null || (projectError.value instanceof ApiError && [403, 404].includes(projectError.value.status)))
function retry() { void Promise.all([refetchProject(), refetch()]) }

const gantt = ref<InstanceType<typeof ScheduleGantt> | null>(null)
const scales = computed(() => [{ value: 'week', label: t('projects.schedule.week') }, { value: 'month', label: t('projects.schedule.month') }])
const createTo = computed(() => ({ path: `/projects/${projectId.value}/tasks/new`, query: { ...route.query, ...returnToQuery(route.fullPath), tab: 'tasks' } }))
</script>

<template>
  <SharedTimelineFrame
    v-if="isBaseRoute"
    hide-header
    :title="t('projects.schedule.title')"
    :range-label="columnSpanLabel"
    :scale="scale"
    :scales="scales"
    @prev="gantt?.scrollPage(-1)"
    @next="gantt?.scrollPage(1)"
    @today="gantt?.scrollToToday()"
    @update:scale="scale = $event as ScheduleScale"
  >
    <template v-if="project?.active && can('pmo.tasks.create')" #actions>
      <UButton icon="i-lucide-plus" data-testid="project-header-create" :disabled="!hydrated" :to="createTo" :label="t('tasks.new')" />
    </template>
    <SharedPageState
      :loading="isLoading && !schedule"
      :error="projectError || error"
      :empty="projectId === null || notFound || (!isLoading && !schedule && !error)"
      :empty-text="projectId === null || notFound ? t('projects.notFound') : t('projects.schedule.empty')"
      @retry="retry"
    >
      <ScheduleGantt v-if="schedule" ref="gantt" :schedule="schedule" :scale="scale" :project-start="project?.date_start" :project-end="project?.date_end" />
    </SharedPageState>
  </SharedTimelineFrame>
  <NuxtPage />
</template>
