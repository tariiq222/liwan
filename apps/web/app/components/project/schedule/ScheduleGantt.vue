<script setup lang="ts">
import type { ProjectSchedule } from '@nasq/contracts'
import { STATE_TONE, type StateTone } from '@/composables/taskState'
import { buildScheduleAxis, formatScheduleDate, scheduleBarStyle, scheduleDatePosition, type ScheduleScale } from '@/utils/projectSchedule'
import { returnToQuery } from '@/utils/safeReturnTo'

const BAR_TONE: Record<StateTone, string> = {
  info: 'nasq-gantt-bar-info',
  success: 'nasq-gantt-bar-success',
  warning: 'nasq-gantt-bar-warning',
  destructive: 'nasq-gantt-bar-danger',
  neutral: 'nasq-gantt-bar-muted',
}

const props = defineProps<{
  schedule: ProjectSchedule
  scale: ScheduleScale
  projectStart?: string | null
  projectEnd?: string | null
}>()
const emit = defineEmits<{ 'update:scale': [ScheduleScale] }>()
const { t, locale } = useI18n()
const route = useRoute()
const hydrated = useHydrated()
const axis = computed(() => buildScheduleAxis(props.schedule.tasks, props.schedule.milestones, props.scale, {
  start: props.projectStart,
  end: props.projectEnd,
}))
const datedMilestones = computed(() => props.schedule.milestones.filter(item => item.deadline))
const legendStates = computed(() => [...new Set(props.schedule.tasks.map(task => task.state))])
const gridStyle = computed(() => ({
  gridTemplateColumns: `minmax(148px, 180px) ${axis.value.width}px`,
  '--gantt-cols': String(axis.value.dates.length),
}))
const columnLabel = (index: number) => t(props.scale === 'month' ? 'projects.schedule.monthLabel' : 'projects.schedule.weekLabel', { n: index + 1 })
const stateLabel = (state: string) => t(`tasks.state.${state}`)
const returnQuery = computed(() => new URLSearchParams(returnToQuery(route.fullPath)).toString())
const taskLink = (taskId: number) => props.schedule.can_manage ? `/projects/${props.schedule.project_id}/schedule/tasks/${taskId}?${returnQuery.value}` : `/tasks/${taskId}?${returnQuery.value}`
const datePosition = (value: string) => scheduleDatePosition(value, axis.value)
const barClass = (state: string) => BAR_TONE[(STATE_TONE as Record<string, StateTone>)[state] ?? 'neutral']
</script>

<template>
  <Card class="nasq-panel overflow-hidden">
    <CardHeader class="flex flex-row flex-wrap items-center justify-between gap-3">
      <CardTitle>{{ t('projects.schedule.timeline') }}</CardTitle>
      <div class="flex rounded-lg border p-0.5" role="group" :aria-label="t('projects.schedule.scale')">
        <Button type="button" size="sm" class="h-8 rounded-md" :variant="scale === 'week' ? 'default' : 'ghost'" :disabled="!hydrated" :aria-pressed="scale === 'week'" @click="emit('update:scale', 'week')">{{ t('projects.schedule.week') }}</Button>
        <Button type="button" size="sm" class="h-8 rounded-md" :variant="scale === 'month' ? 'default' : 'ghost'" :disabled="!hydrated" :aria-pressed="scale === 'month'" @click="emit('update:scale', 'month')">{{ t('projects.schedule.month') }}</Button>
      </div>
    </CardHeader>
    <CardContent class="p-0">
      <div class="nasq-gantt">
        <div class="nasq-gantt-grid" :style="gridStyle">
          <div class="nasq-gantt-name nasq-gantt-corner">{{ t('projects.schedule.task') }}</div>
          <div class="nasq-gantt-head" role="row">
            <span
              v-for="(date, index) in axis.dates"
              :key="date"
              :title="formatScheduleDate(date, locale)"
            >{{ columnLabel(index) }}</span>
          </div>

          <template v-if="datedMilestones.length">
            <div class="nasq-gantt-name">{{ t('projects.schedule.milestones') }}</div>
            <div class="nasq-gantt-track">
              <span
                v-for="milestone in datedMilestones"
                :key="milestone.id"
                class="nasq-gantt-mark nasq-status-dot-warning"
                :style="datePosition(milestone.deadline!)"
                :title="`${milestone.name} · ${milestone.deadline}`"
                :data-milestone-id="milestone.id"
              />
            </div>
          </template>

          <div v-if="!schedule.tasks.length" class="nasq-gantt-empty">{{ t('projects.schedule.empty') }}</div>

          <template v-for="task in schedule.tasks" :key="task.id">
            <NuxtLink class="nasq-gantt-name nasq-gantt-task" :to="taskLink(task.id)">{{ task.name }}</NuxtLink>
            <div class="nasq-gantt-track">
              <div
                v-if="task.start && task.end"
                class="nasq-gantt-bar"
                :class="barClass(task.state)"
                :style="scheduleBarStyle(task, axis)"
                :title="`${task.name}: ${task.start} – ${task.end}`"
                aria-hidden="true"
              />
              <span
                v-else-if="task.end"
                class="nasq-gantt-mark nasq-status-dot-warning"
                :style="datePosition(task.end)"
                :title="t('projects.schedule.endOnly', { date: task.end })"
              />
            </div>
          </template>
        </div>
      </div>
      <ul v-if="legendStates.length" class="nasq-gantt-legend">
        <li v-for="state in legendStates" :key="state">
          <span class="nasq-gantt-swatch" :class="barClass(state)" aria-hidden="true" />
          {{ stateLabel(state) }}
        </li>
      </ul>
    </CardContent>
  </Card>
</template>
