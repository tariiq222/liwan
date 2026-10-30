<script setup lang="ts">
import type { Task } from '@liwan/contracts'
import type { RouteLocationRaw } from 'vue-router'
import { statusPillAttrs } from '@liwan/ui/app/utils/statusPill'
import { deadlineTagView } from './taskDeadline'
import type { BoardStage } from '@/composables/boardStages'
import { PRIORITY_ICON, PRIORITY_LABEL_KEY, PRIORITY_TONE } from '@/composables/taskState'

const props = withDefaults(defineProps<{
  task: Task
  to: RouteLocationRaw
  stages?: BoardStage[]
  currentStageId?: number | null
  // Explicit "move to" menu entries (the board passes status transitions); without them the card lists `stages`.
  moveTargets?: { label: string; disabled?: boolean; onSelect: () => void }[]
  showProject?: boolean
}>(), {
  stages: () => [],
  currentStageId: null,
  moveTargets: undefined,
  showProject: true,
})
const emit = defineEmits<{
  open: [id: number]
  move: [stage: BoardStage]
}>()

const { t } = useI18n()

// Subtask progress from the list counts; the server counts a done subtask as done, never a cancelled one.
const subtaskProgress = computed(() => {
  const { subtask_count: total, subtask_done_count: done } = props.task
  if (total <= 0) return null
  return { done, total, percent: Math.round((done / total) * 100) }
})
const priority = computed(() => props.task.priority as '0' | '1' | '2' | '3')
const deadline = computed(() => deadlineTagView(props.task, t))

const moveItems = computed(() => props.moveTargets ?? (props.task.can_write
  ? props.stages.map((stage) => ({
      label: stage.name,
      disabled: props.currentStageId === stage.id,
      onSelect: () => emit('move', stage),
    }))
  : []))

function onCardClick(event: MouseEvent) {
  const target = event.target as HTMLElement
  if (target.closest('a, button, [role="menu"], [data-state]')) return
  emit('open', props.task.id)
}
</script>

<template>
  <div
    :data-testid="`board-card-${task.id}`"
    :data-task-id="task.id"
    :data-readonly="!task.can_write"
    class="group relative flex shrink-0 cursor-pointer flex-col gap-2 rounded-control border border-default bg-default p-3.5 transition duration-150 hover:-translate-y-px hover:shadow-md focus-visible:outline-2 focus-visible:outline-primary motion-reduce:transition-none motion-reduce:hover:translate-y-0"
    @click="onCardClick"
  >
    <div class="flex items-center gap-2">
      <span
        v-bind="statusPillAttrs(PRIORITY_TONE[priority])"
        class="justify-center"
        style="width: 1.571rem; height: 1.571rem; padding: 0"
        role="img"
        :aria-label="t(PRIORITY_LABEL_KEY[priority])"
        :title="t(PRIORITY_LABEL_KEY[priority])"
        data-testid="card-priority"
      ><UIcon :name="PRIORITY_ICON[priority]" class="size-3.5" aria-hidden="true" /></span>
      <SharedRecordNumber :value="`#${task.id}`" />
      <UDropdownMenu v-if="moveItems.length" :items="moveItems" :content="{ align: 'end' }">
        <UButton
          type="button"
          square
          size="sm"
          color="neutral"
          variant="ghost"
          class="ms-auto rounded-full opacity-0 transition-opacity duration-150 group-focus-within:opacity-100 group-hover:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100 motion-reduce:transition-none pointer-coarse:opacity-100"
          icon="i-lucide-ellipsis"
          :aria-label="t('tasks.detail.menu')"
          @click.stop
        />
      </UDropdownMenu>
    </div>

    <NuxtLink :to="to" class="line-clamp-2 text-sm font-semibold text-highlighted hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary" :title="task.name">{{ task.name }}</NuxtLink>
    <p v-if="showProject && task.project" class="flex min-w-0 items-center gap-1 text-xs text-muted">
      <UIcon name="i-lucide-folder" class="size-3.5 shrink-0" aria-hidden="true" /><span class="truncate">{{ task.project.name }}</span>
    </p>

    <div v-if="subtaskProgress" class="grid gap-1" data-testid="card-subtasks">
      <p class="flex items-center gap-1 text-xs text-muted tabular-nums"><UIcon name="i-lucide-check" class="size-3.5" aria-hidden="true" />{{ subtaskProgress.done }} / {{ subtaskProgress.total }}</p>
      <div role="progressbar" :aria-label="t('tasks.card.subtasks')" aria-valuemin="0" aria-valuemax="100" :aria-valuenow="subtaskProgress.percent" class="h-[5px] overflow-hidden rounded-full bg-(--ui-border-muted)">
        <div class="h-full rounded-full bg-primary" :style="{ width: `${subtaskProgress.percent}%` }" />
      </div>
    </div>

    <div class="flex min-h-7 items-center gap-2">
      <SharedStatusBadge v-if="deadline" v-bind="deadline" data-testid="deadline-badge" size="sm" :aria-label="`${deadline.label} ${deadline.title ?? ''}`.trim()" />
      <span v-if="task.attachment_count > 0" class="flex items-center gap-1 text-xs text-muted tabular-nums" data-testid="card-attachments" :title="t('tasks.card.attachments')">
        <UIcon name="i-lucide-paperclip" class="size-3.5" aria-hidden="true" />{{ task.attachment_count }}
      </span>
      <SharedPersonAvatar v-if="task.assignees.length" class="ms-auto" :people="task.assignees" />
    </div>
  </div>
</template>
