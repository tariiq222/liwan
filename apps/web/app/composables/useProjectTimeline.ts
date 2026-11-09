import { toValue, type MaybeRefOrGetter, type Ref } from 'vue'
import type ScheduleGantt from '@/components/pmo/projects/schedule/ScheduleGantt.vue'
import { useBaselineVariance } from './useProjectBaselines'
import { useProjectSchedule } from './useProjectSchedule'
import { MONTH_DAYS, buildScheduleAxis, scheduleColumnSpan, type ScheduleScale } from '@/utils/projectSchedule'

/**
 * The timeline view of a project's task list (`?view=timeline`): the schedule, the latest baseline when the plan has one,
 * the scale kept in the URL (`?scale=`) and the label of the range the columns cover. It only reads while `active` is
 * true, so the table and the board never load the schedule.
 */
export function useProjectTimeline(
  projectId: Ref<number | null>,
  project: Ref<{ date_start?: string | null; date_end?: string | null } | undefined>,
  active: MaybeRefOrGetter<boolean>,
) {
  const route = useRoute()
  const router = useRouter()
  const { t, te, locale } = useI18n()
  const scheduleId = computed(() => (toValue(active) ? projectId.value : null))
  const schedule = useProjectSchedule(scheduleId)
  // A failed baseline read just leaves the bars unmarked.
  const baselineVariance = useBaselineVariance(projectId, active)
  const baseline = computed(() => {
    const data = baselineVariance.data.value
    if (!data?.baseline || !data.schedule) return undefined
    const tasks: Record<number, { start: string; end: string }> = {}
    for (const row of data.schedule.tasks) if (row.task_id && row.baseline_start && row.baseline_end) tasks[row.task_id] = { start: row.baseline_start, end: row.baseline_end }
    return { number: data.baseline.number, tasks }
  })
  const scale = computed<ScheduleScale>({
    get: () => route.query.scale === 'month' ? 'month' : 'week',
    set: value => { void router.replace({ query: { ...route.query, scale: value } }) },
  })
  const scales = computed(() => [{ value: 'week', label: t('projects.schedule.week') }, { value: 'month', label: t('projects.schedule.month') }])
  // Same axis inputs as ScheduleGantt, so the label names the columns it draws.
  const rangeLabel = computed(() => {
    if (!schedule.data.value) return ''
    const axis = buildScheduleAxis(schedule.data.value.tasks, schedule.data.value.milestones, scale.value, {
      start: project.value?.date_start, end: project.value?.date_end,
    })
    const span = scheduleColumnSpan(axis, scale.value, locale.value)
    const key = `projects.schedule.columnSpan.${span.unit}.${span.form}`
    const label = t(te(key) ? key : `projects.schedule.columnSpan.${span.unit}.other`, { n: span.count })
    // Columns are grouped once the axis unit exceeds one nominal week or month.
    return axis.unitDays > (scale.value === 'month' ? MONTH_DAYS : 7) ? t('projects.schedule.columnSpanGrouped', { span: label }) : label
  })
  const gantt = ref<InstanceType<typeof ScheduleGantt> | null>(null)
  return { schedule, baseline, scale, scales, rangeLabel, gantt }
}
