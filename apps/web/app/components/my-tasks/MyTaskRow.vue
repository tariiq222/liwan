<script setup lang="ts">
import type { MyTaskListItem } from '@nasq/contracts'
import { formatCalendarDate } from '@/composables/calendarDate'
import { deadlineDay, isOverdue } from '@/utils/myTaskList'

// One row of the unified list. A project row links to the server-supplied `href` (the web never
// builds a project URL); a personal row links to its detail page and carries the list URL as
// `returnTo`, so going back restores the tab, scope and search.
const props = defineProps<{
  task: MyTaskListItem
  /** The list's own full path (path + query). */
  returnTo: string
  /** Local `YYYY-MM-DD`, or null before the page is mounted (no overdue styling then). */
  today: string | null
}>()

const { t, locale } = useI18n()

const MAX_AVATARS = 3
const STATE_COLOR = { open: 'info', done: 'success', cancelled: 'neutral' } as const

const to = computed(() => props.task.source === 'project'
  ? props.task.href
  : { path: `/my-tasks/${props.task.id}`, query: { returnTo: props.returnTo } })
const day = computed(() => deadlineDay(props.task.date_deadline))
const overdue = computed(() => props.today !== null && isOverdue(props.task.date_deadline, props.task.state, props.today))
const shown = computed(() => props.task.assignees.slice(0, MAX_AVATARS))
const hidden = computed(() => props.task.assignees.length - shown.value.length)

// One letter: two joined Arabic letters do not fit an extra-small avatar and clip.
function initials(name: string): string {
  return name.trim().charAt(0).toUpperCase() || '?'
}
</script>

<template>
  <li
    class="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2 p-3"
    data-testid="my-task-row"
    :data-source="task.source"
  >
    <div class="min-w-0 flex-1 basis-64">
      <div class="flex min-w-0 items-center gap-2">
        <span v-if="task.priority === 'high'" class="shrink-0 text-error" data-testid="my-task-priority">
          <UIcon name="i-lucide-flag" class="size-4" aria-hidden="true" />
          <span class="sr-only">{{ t('myTasks.priority.high') }}</span>
        </span>
        <NuxtLink
          :to="to"
          class="min-w-0 break-words font-medium text-highlighted hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          :class="task.state !== 'open' && 'text-muted'"
        >
          {{ task.name }}
        </NuxtLink>
      </div>
      <p class="mt-0.5 flex min-w-0 items-center gap-1 text-sm text-muted">
        <UIcon :name="task.project ? 'i-lucide-folder-kanban' : 'i-lucide-user'" class="size-3.5 shrink-0" aria-hidden="true" />
        <span class="truncate">{{ task.project ? t('myTasks.list.project', { name: task.project.name }) : t('myTasks.list.personal') }}</span>
      </p>
    </div>

    <UBadge :color="STATE_COLOR[task.state]" variant="subtle" class="shrink-0">{{ t(`myTasks.state.${task.state}`) }}</UBadge>

    <p
      class="flex shrink-0 items-center gap-1 text-sm"
      :class="overdue ? 'font-medium text-error' : 'text-muted'"
      data-testid="my-task-deadline"
      :data-overdue="overdue"
    >
      <UIcon name="i-lucide-calendar" class="size-4" aria-hidden="true" />
      <span v-if="day">{{ formatCalendarDate(task.date_deadline, locale) }}</span>
      <span v-else>{{ t('myTasks.list.noDeadline') }}</span>
      <span v-if="overdue" class="sr-only">{{ t('myTasks.list.overdue') }}</span>
    </p>

    <div v-if="task.assignees.length" class="flex shrink-0 items-center" role="group" :aria-label="t('myTasks.list.assignees')">
      <UAvatar
        v-for="person in shown"
        :key="person.id"
        :text="initials(person.name)"
        :alt="person.name"
        :title="person.name"
        size="xs"
        class="-ms-1 border-2 border-default first:ms-0"
      />
      <span v-if="hidden > 0" class="ms-1 text-xs text-muted" dir="ltr">+{{ hidden }}</span>
    </div>
  </li>
</template>
