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

const props = defineProps<{ schedule: ProjectSchedule; scale: ScheduleScale }>()
const emit = defineEmits<{ 'update:scale': [ScheduleScale] }>()
const { t, locale } = useI18n()
const route = useRoute()
const hydrated = useHydrated()
const axis = computed(() => buildScheduleAxis(props.schedule.tasks, props.schedule.milestones, props.scale))
const datedMilestones = computed(() => props.schedule.milestones.filter(item => item.deadline))
const today = new Date().toISOString().slice(0, 10)
const todayStyle = computed(() => {
  if (today < axis.value.start || today > axis.value.end) return null
  return scheduleDatePosition(today, axis.value)
})
const gridStyle = computed(() => ({
  gridTemplateColumns: `minmax(200px, 260px) ${axis.value.width}px`,
  '--gantt-col': `${axis.value.columnWidth}px`,
}))
const dateLabel = (value: string) => formatScheduleDate(value, locale.value)
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
    <CardContent class="nasq-gantt p-0">
      <div class="nasq-gantt-grid" :style="gridStyle">
        <div class="nasq-gantt-name border-b px-3 py-2 text-xs font-medium text-muted-foreground">{{ t('projects.schedule.task') }}</div>
        <div class="nasq-gantt-track h-11 border-b" :style="{ width: `${axis.width}px` }">
          <span v-for="date in axis.dates" :key="date" class="absolute top-0 px-1 pt-2 text-[11px] text-muted-foreground" :style="datePosition(date)">{{ dateLabel(date) }}</span>
        </div>

        <template v-if="datedMilestones.length">
          <div class="nasq-gantt-name border-b px-3 py-2 text-xs text-muted-foreground">{{ t('projects.schedule.milestones') }}</div>
          <div class="nasq-gantt-track h-11 border-b" :style="{ width: `${axis.width}px` }">
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

        <div v-if="!schedule.tasks.length" class="col-span-2 p-8 text-center text-sm text-muted-foreground">{{ t('projects.schedule.empty') }}</div>

        <template v-for="task in schedule.tasks" :key="task.id">
          <NuxtLink class="nasq-gantt-name flex flex-col justify-center border-b px-3 py-2 hover:bg-muted/40" :to="taskLink(task.id)">
            <span class="truncate text-sm font-medium">{{ task.name }}</span>
            <span class="truncate text-[11px] text-muted-foreground">{{ stateLabel(task.state) }}<template v-if="!(task.start && task.end)"> · {{ task.end ? t('projects.schedule.endOnly', { date: task.end }) : t('projects.schedule.undated') }}</template></span>
          </NuxtLink>
          <div class="nasq-gantt-track border-b" :style="{ width: `${axis.width}px` }">
            <div v-if="todayStyle" class="nasq-gantt-today" :style="todayStyle" aria-hidden="true" />
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
    </CardContent>
  </Card>
</template>
