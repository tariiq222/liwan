<script setup lang="ts">
import type { ProjectSchedule } from '@nasq/contracts'
import { STATE_TONE, type StateTone } from '@/composables/taskState'
import { buildScheduleAxis, formatScheduleDate, scheduleBarStyle, scheduleDatePosition, scheduleFocusDate, type ScheduleScale } from '@/utils/projectSchedule'
import { returnToQuery } from '@/utils/safeReturnTo'

const BAR_TONE: Record<StateTone, string> = {
  info: 'schedule-gantt-bar-info',
  success: 'schedule-gantt-bar-success',
  warning: 'schedule-gantt-bar-warning',
  destructive: 'schedule-gantt-bar-danger',
  neutral: 'schedule-gantt-bar-muted',
}

const props = defineProps<{
  schedule: ProjectSchedule
  scale: ScheduleScale
  projectStart?: string | null
  projectEnd?: string | null
}>()
const { t, locale } = useI18n()
const route = useRoute()
const hydrated = useHydrated()
const axis = computed(() => buildScheduleAxis(props.schedule.tasks, props.schedule.milestones, props.scale, {
  start: props.projectStart,
  end: props.projectEnd,
}))
const datedMilestones = computed(() => props.schedule.milestones.filter(item => item.deadline))
const today = computed(() => hydrated.value ? new Date().toISOString().slice(0, 10) : '')
const showToday = computed(() => !!today.value && today.value >= axis.value.start && today.value < axis.value.end)
const legendStates = computed(() => [...new Set(props.schedule.tasks.map(task => task.state))])
const gridStyle = computed(() => ({
  gridTemplateColumns: `minmax(148px, 180px) ${axis.value.width}px`,
  '--gantt-cols': String(axis.value.dates.length),
}))
const stateLabel = (state: string) => t(`tasks.state.${state}`)
const returnQuery = computed(() => new URLSearchParams(returnToQuery(route.fullPath)).toString())
const taskLink = (taskId: number) => props.schedule.can_manage ? `/projects/${props.schedule.project_id}/schedule/tasks/${taskId}?${returnQuery.value}` : `/tasks/${taskId}?${returnQuery.value}`
const milestoneLink = (milestoneId: number) => props.schedule.can_manage
  ? { path: `/projects/${props.schedule.project_id}/milestones/${milestoneId}/edit`, query: { returnTo: route.fullPath } }
  : { path: `/projects/${props.schedule.project_id}`, query: { tab: 'milestones', returnTo: route.fullPath } }
const datePosition = (value: string) => scheduleDatePosition(value, axis.value)
const markerPosition = (value: string) => ({ insetInlineStart: `clamp(8px, ${datePosition(value).insetInlineStart}, calc(100% - 8px))` })
const barClass = (state: string) => BAR_TONE[(STATE_TONE as Record<string, StateTone>)[state] ?? 'neutral']

// The track runs left-to-right inside an RTL page, so the browser opens the
// scroller at the timeline's end. Bring today (or the start) into view instead,
// with a quarter of the visible track before it. A delta via scrollBy is independent of
// the RTL scrollLeft sign convention.
const scroller = ref<HTMLElement | null>(null)
const focusAnchor = ref<HTMLElement | null>(null)
const focusDate = computed(() => scheduleFocusDate(axis.value, today.value))
async function scrollToFocus() {
  await nextTick()
  const container = scroller.value
  const anchor = focusAnchor.value
  if (!container || !anchor) return
  const nameWidth = container.querySelector<HTMLElement>('.schedule-gantt-corner')?.offsetWidth ?? 0
  const box = container.getBoundingClientRect()
  const visibleLeft = box.left + (getComputedStyle(container).direction === 'ltr' ? nameWidth : 0)
  // A quarter of the visible track stays before the focus date for context.
  const lead = Math.max(box.width - nameWidth, 0) / 4
  container.scrollBy({ left: anchor.getBoundingClientRect().left - visibleLeft - lead })
}
watch([hydrated, () => props.scale, () => axis.value.start, () => axis.value.end], () => {
  if (hydrated.value) void scrollToFocus()
}, { immediate: true, flush: 'post' })
function scrollPage(direction: 1 | -1) {
  const container = scroller.value
  if (container) container.scrollBy({ left: direction * container.clientWidth * 0.8 })
}
defineExpose({ scrollPage, scrollToToday: scrollToFocus })
</script>

<template>
  <UCard class="overflow-hidden" :ui="{ body: 'p-0' }">
      <div ref="scroller" class="schedule-gantt" data-testid="schedule-gantt-scroller">
        <div class="schedule-gantt-grid" :style="gridStyle">
          <div class="schedule-gantt-name schedule-gantt-corner">{{ t('projects.schedule.task') }}</div>
          <div class="schedule-gantt-head" role="row">
            <span ref="focusAnchor" class="schedule-gantt-focus" :style="datePosition(focusDate)" aria-hidden="true" />
            <span
              v-for="date in axis.dates"
              :key="date"
              :title="date"
            >{{ formatScheduleDate(date, locale) }}</span>
          </div>

          <template v-if="datedMilestones.length">
            <div class="schedule-gantt-name">{{ t('projects.schedule.milestones') }}</div>
            <div class="schedule-gantt-track">
              <NuxtLink
                v-for="milestone in datedMilestones"
                :key="milestone.id"
                class="schedule-gantt-mark nasq-status-dot-warning"
                :style="markerPosition(milestone.deadline!)"
                :title="`${milestone.name} · ${milestone.deadline}`"
                :data-milestone-id="milestone.id"
                :to="milestoneLink(milestone.id)"
                :aria-label="milestone.name"
              />
            </div>
          </template>

          <div v-if="!schedule.tasks.length" class="schedule-gantt-empty">{{ t('projects.schedule.empty') }}</div>

          <template v-for="task in schedule.tasks" :key="task.id">
            <NuxtLink class="schedule-gantt-name schedule-gantt-task" :to="taskLink(task.id)" :title="task.name">
              <span class="min-w-0 w-full">
                <span class="block truncate">{{ task.name }}</span>
                <span class="block text-xs font-normal text-muted">{{ stateLabel(task.state) }}</span>
              </span>
            </NuxtLink>
            <div class="schedule-gantt-track">
              <span v-if="showToday" class="schedule-gantt-today" :style="datePosition(today)" aria-hidden="true" />
              <div
                v-if="task.start && task.end"
                class="schedule-gantt-bar"
                :class="barClass(task.state)"
                :style="scheduleBarStyle(task, axis)"
                :title="`${task.name}: ${task.start} – ${task.end}`"
                aria-hidden="true"
              />
              <span
                v-else-if="task.end"
                class="schedule-gantt-mark nasq-status-dot-warning"
                :style="markerPosition(task.end)"
                :title="t('projects.schedule.endOnly', { date: task.end })"
              />
              <span class="schedule-gantt-dates">
                <template v-if="task.start && task.end">{{ formatScheduleDate(task.start, locale) }} – {{ formatScheduleDate(task.end, locale) }}</template>
                <template v-else-if="task.end">{{ t('projects.schedule.endOnly', { date: formatScheduleDate(task.end, locale) }) }}</template>
                <template v-else>{{ t('projects.schedule.undated') }}</template>
              </span>
            </div>
          </template>
        </div>
      </div>
      <ul v-if="legendStates.length" class="schedule-gantt-legend">
        <li v-if="showToday"><span class="schedule-gantt-today-key" aria-hidden="true" />{{ t('projects.schedule.today') }} · {{ formatScheduleDate(today, locale) }}</li>
        <li v-for="state in legendStates" :key="state">
          <span class="schedule-gantt-swatch" :class="barClass(state)" aria-hidden="true" />
          {{ stateLabel(state) }}
        </li>
      </ul>
      <ul v-if="datedMilestones.length" class="schedule-gantt-legend" :aria-label="t('projects.schedule.milestones')">
        <li v-for="milestone in datedMilestones" :key="milestone.id">{{ milestone.name }} · {{ formatScheduleDate(milestone.deadline!, locale) }}</li>
      </ul>
  </UCard>
</template>
