<script setup lang="ts">
import type { MyTaskListItem } from '@liwan/contracts'
import type { RouteLocationRaw } from 'vue-router'
import { formatCalendarDate } from '@liwan/ui/app/composables/calendarDate'
import { deadlineDay, isOverdue } from '@/utils/myTaskList'

// One task of the unified list as the parts SharedDataTable asks for: the name cell, the state, the deadline,
// the assignees, and the phone row (`card`) that carries them all. A project row links to the server-supplied
// `href` (the web never builds a project URL); a personal row to its detail page (the page builds `to`).
const props = defineProps<{
  task: MyTaskListItem
  to: RouteLocationRaw
  /** Local `YYYY-MM-DD`, or null before the page is mounted (no overdue styling then). */
  today: string | null
  part: 'name' | 'state' | 'deadline' | 'assignees' | 'card'
}>()
const emit = defineEmits<{ open: [event: MouseEvent, task: MyTaskListItem] }>()
function openLive(event: MouseEvent) {
  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
  event.preventDefault()
  emit('open', event, props.task)
}
const { t } = useI18n()
const STATE_TONE = { open: 'info', done: 'success', cancelled: 'destructive' } as const
const day = computed(() => deadlineDay(props.task.date_deadline))
const overdue = computed(() => props.today !== null && isOverdue(props.task.date_deadline, props.task.state, props.today))
// The deadline pill follows the main task table: a closed task is calm, overdue is destructive, today warns, later is fine.
// Before mount `today` is null, so nothing is styled as urgent during SSR.
const deadlinePill = computed(() => {
  if (props.task.state !== 'open') return { tone: 'neutral', icon: 'i-lucide-calendar-check' } as const
  if (overdue.value) return { tone: 'destructive', icon: 'i-lucide-timer-off' } as const
  if (props.today === null) return { tone: 'neutral', icon: 'i-lucide-calendar' } as const
  return day.value === props.today ? { tone: 'warning', icon: 'i-lucide-alarm-clock' } as const : { tone: 'success', icon: 'i-lucide-hourglass' } as const
})
const deadlineText = computed(() => formatCalendarDate(props.task.date_deadline))
</script>

<template>
  <div v-if="part === 'name' || part === 'card'" :data-testid="part === 'name' ? 'my-task-row' : 'my-task-row-card'" :data-source="task.source" class="min-w-0 space-y-2">
    <div class="flex min-w-0 items-start gap-2">
      <span v-if="task.priority === 'high'" class="shrink-0 text-warning" data-testid="my-task-priority">
        <UIcon name="i-lucide-flag" class="size-4" aria-hidden="true" />
        <span class="sr-only">{{ t('myTasks.priority.high') }}</span>
      </span>
      <NuxtLink :to="to" @click.capture="openLive" class="min-w-0 break-words text-base font-semibold hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary" :class="task.state !== 'open' ? 'text-muted' : 'text-highlighted'">{{ task.name }}</NuxtLink>
      <SharedStatusBadge v-if="part === 'card'" class="ms-auto shrink-0" size="sm" :tone="STATE_TONE[task.state]" :label="t(`myTasks.state.${task.state}`)" />
    </div>
    <p class="flex min-w-0 items-center gap-1 text-sm text-muted">
      <UIcon :name="task.project ? 'i-lucide-folder-kanban' : 'i-lucide-user'" class="size-3.5 shrink-0" aria-hidden="true" />
      <span class="truncate">{{ task.project ? task.project.name : t('myTasks.list.personal') }}</span>
    </p>
    <div v-if="part === 'card'" class="flex flex-wrap items-center justify-between gap-x-4 gap-y-3 border-t border-default pt-3">
      <MyTaskRow :task="task" :to="to" :today="today" part="deadline" />
      <MyTaskRow :task="task" :to="to" :today="today" part="assignees" />
    </div>
  </div>

  <SharedStatusBadge v-else-if="part === 'state'" size="sm" :tone="STATE_TONE[task.state]" :label="t(`myTasks.state.${task.state}`)" />

  <div v-else-if="part === 'deadline'" class="text-sm" data-testid="my-task-deadline" :data-overdue="overdue">
    <SharedStatusBadge v-if="day" v-bind="deadlinePill" size="sm" :label="deadlineText" :aria-label="overdue ? `${t('myTasks.list.overdue')} ${deadlineText}` : deadlineText" :title="overdue ? t('myTasks.list.overdue') : undefined" dir="ltr" />
    <span v-else class="text-muted">{{ t('myTasks.list.noDeadline') }}</span>
  </div>

  <SharedPersonAvatar v-else :people="task.assignees" />
</template>
