<script setup lang="ts">
import type { MyTaskListItem } from '@nasq/contracts'
import type { RouteLocationRaw } from 'vue-router'
import { formatCalendarDate } from '@nasq/ui/app/composables/calendarDate'
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
const { t, locale } = useI18n()
const MAX_AVATARS = 3
const STATE_TONE = { open: 'info', done: 'success', cancelled: 'destructive' } as const
const day = computed(() => deadlineDay(props.task.date_deadline))
const overdue = computed(() => props.today !== null && isOverdue(props.task.date_deadline, props.task.state, props.today))
const shown = computed(() => props.task.assignees.slice(0, MAX_AVATARS))
const hidden = computed(() => props.task.assignees.length - shown.value.length)
// One letter: two joined Arabic letters do not fit an extra-small avatar and clip.
const initials = (name: string) => name.trim().charAt(0).toUpperCase() || '?'
</script>

<template>
  <div v-if="part === 'name' || part === 'card'" :data-testid="part === 'name' ? 'my-task-row' : 'my-task-row-card'" :data-source="task.source" class="min-w-0 space-y-2">
    <div class="flex min-w-0 items-start gap-2">
      <span v-if="task.priority === 'high'" class="shrink-0 text-warning" data-testid="my-task-priority">
        <UIcon name="i-lucide-flag" class="size-4" aria-hidden="true" />
        <span class="sr-only">{{ t('myTasks.priority.high') }}</span>
      </span>
      <NuxtLink :to="to" @click.capture="openLive" class="min-w-0 break-words font-medium hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary" :class="task.state !== 'open' ? 'text-muted' : 'text-primary'">{{ task.name }}</NuxtLink>
      <SharedStatusBadge v-if="part === 'card'" class="ms-auto shrink-0" :tone="STATE_TONE[task.state]" :label="t(`myTasks.state.${task.state}`)" />
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

  <SharedStatusBadge v-else-if="part === 'state'" :tone="STATE_TONE[task.state]" :label="t(`myTasks.state.${task.state}`)" />

  <div v-else-if="part === 'deadline'" class="flex flex-wrap items-center gap-2 text-sm" data-testid="my-task-deadline" :data-overdue="overdue">
    <span class="inline-flex items-center gap-1.5 whitespace-nowrap tabular-nums" :class="overdue ? 'text-error' : 'text-muted'">
      <UIcon v-if="day" name="i-lucide-calendar" class="size-4 shrink-0" aria-hidden="true" />
      <time v-if="day" :datetime="day" dir="ltr">{{ formatCalendarDate(task.date_deadline, locale) }}</time>
      <span v-else>{{ t('myTasks.list.noDeadline') }}</span>
    </span>
    <SharedStatusBadge v-if="overdue" tone="destructive" size="sm" :label="t('myTasks.list.overdue')" />
  </div>

  <div v-else-if="task.assignees.length" class="flex shrink-0 items-center" role="group" :aria-label="t('myTasks.list.assignees')">
    <UAvatar v-for="person in shown" :key="person.id" :text="initials(person.name)" :alt="person.name" :title="person.name" size="xs" class="-ms-1 border-2 border-default first:ms-0" />
    <span v-if="task.assignees.length === 1" class="ms-2 max-w-28 truncate text-sm" :title="task.assignees[0]?.name">{{ task.assignees[0]?.name }}</span>
    <span v-if="hidden > 0" class="ms-1 text-xs text-muted" dir="ltr">+{{ hidden }}</span>
  </div>
  <span v-else class="text-muted">—</span>
</template>
