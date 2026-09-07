<script setup lang="ts">
import type { ProjectSchedule } from '@nasq/contracts'
import { buildScheduleAxis, formatScheduleDate, scheduleBarStyle, scheduleDatePosition, type ScheduleScale } from '@/utils/projectSchedule'
import { returnToQuery } from '@/utils/safeReturnTo'

const props = defineProps<{ schedule: ProjectSchedule; scale: ScheduleScale }>()
const emit = defineEmits<{ 'update:scale': [ScheduleScale] }>()
const { t, locale } = useI18n()
const route = useRoute()
const hydrated = useHydrated()
const axis = computed(() => buildScheduleAxis(props.schedule.tasks, props.schedule.milestones, props.scale))
const taskNames = computed(() => new Map(props.schedule.tasks.map(task => [task.id, task.name])))
const dateLabel = (value: string) => formatScheduleDate(value, locale.value)
const stateLabel = (state: string) => t(`tasks.states.${state}`)
const returnQuery = computed(() => new URLSearchParams(returnToQuery(route.fullPath)).toString())
const taskLink = (taskId: number) => `/projects/${props.schedule.project_id}/schedule/tasks/${taskId}?${returnQuery.value}`
const datePosition = (value: string) => scheduleDatePosition(value, axis.value)
</script>

<template>
  <Card class="nasq-panel overflow-hidden">
    <CardHeader class="flex flex-row flex-wrap items-center justify-between gap-3">
      <CardTitle>{{ t('projects.schedule.timeline') }}</CardTitle>
      <div class="flex gap-2" role="group" :aria-label="t('projects.schedule.scale')">
        <Button type="button" size="sm" variant="outline" :disabled="!hydrated" :aria-pressed="scale === 'week'" @click="emit('update:scale', 'week')">{{ t('projects.schedule.week') }}</Button>
        <Button type="button" size="sm" variant="outline" :disabled="!hydrated" :aria-pressed="scale === 'month'" @click="emit('update:scale', 'month')">{{ t('projects.schedule.month') }}</Button>
      </div>
    </CardHeader>
    <CardContent class="overflow-x-auto">
      <div class="min-w-[720px]">
        <div class="grid border-b text-xs text-muted-foreground" :style="{ gridTemplateColumns: `minmax(180px,240px) ${axis.width}px` }">
          <div class="p-2 text-start">{{ t('projects.schedule.task') }}</div>
          <div class="relative h-12" :style="{ width: `${axis.width}px` }">
            <span v-for="date in axis.dates" :key="date" class="absolute top-0 h-full border-s p-2 text-center" :style="datePosition(date)">{{ dateLabel(date) }}</span>
          </div>
        </div>
        <div v-if="schedule.milestones.some(milestone => milestone.deadline)" class="grid border-b" :style="{ gridTemplateColumns: `minmax(180px,240px) ${axis.width}px` }">
          <div class="p-2 text-xs text-muted-foreground">{{ t('projects.schedule.milestones') }}</div>
          <div class="relative h-12" :style="{ width: `${axis.width}px` }">
            <span v-for="milestone in schedule.milestones.filter(item => item.deadline)" :key="milestone.id" class="absolute top-2 inline-flex flex-col items-center" :style="{ ...datePosition(milestone.deadline!), marginInlineStart: '-5px' }" :title="`${milestone.name} · ${milestone.deadline}`">
              <span aria-hidden="true" class="size-2 rotate-45 bg-amber-500" />
              <span class="mt-2 whitespace-nowrap text-xs text-muted-foreground">{{ milestone.name }}</span>
            </span>
          </div>
        </div>
        <div v-if="!schedule.tasks.length" class="p-8 text-center text-muted-foreground">{{ t('projects.schedule.empty') }}</div>
        <div v-for="task in schedule.tasks" :key="task.id" class="grid border-b last:border-b-0" :style="{ gridTemplateColumns: `minmax(180px,240px) ${axis.width}px` }">
          <NuxtLink class="p-3 text-start font-medium hover:underline" :to="taskLink(task.id)">
            <span>{{ task.name }}</span>
            <span class="mt-1 block text-xs text-muted-foreground">{{ stateLabel(task.state) }}</span>
          </NuxtLink>
          <div class="relative min-h-20 border-s" :style="{ width: `${axis.width}px` }">
            <span v-for="date in axis.dates" :key="`${task.id}-${date}`" class="absolute inset-y-0 border-s border-border/30" :style="datePosition(date)" aria-hidden="true" />
            <div v-if="task.start && task.end" class="absolute top-4 h-8 rounded-md bg-primary/80 px-2 text-xs leading-8 text-primary-foreground" :style="scheduleBarStyle(task, axis)" :title="`${task.start} – ${task.end}`">
              {{ task.start }} – {{ task.end }}
            </div>
            <span v-else class="absolute inset-y-0 start-3 flex items-center text-xs text-muted-foreground">{{ task.end ? t('projects.schedule.endOnly', { date: task.end }) : t('projects.schedule.undated') }}</span>
            <span v-if="task.dependency_ids.length" class="absolute bottom-0 end-2 inline-flex flex-wrap items-center gap-2 text-xs text-muted-foreground" :aria-label="t('projects.schedule.dependencies')">
              <span aria-hidden="true">↪</span>
              <NuxtLink v-for="dependencyId in task.dependency_ids" :key="dependencyId" class="underline underline-offset-2 hover:text-foreground" :to="taskLink(dependencyId)" :aria-label="`${t('projects.schedule.predecessor')}: ${taskNames.get(dependencyId) ?? dependencyId}`">{{ taskNames.get(dependencyId) }}</NuxtLink>
            </span>
          </div>
        </div>
      </div>
    </CardContent>
  </Card>
</template>
