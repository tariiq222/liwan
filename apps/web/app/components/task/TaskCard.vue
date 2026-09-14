<script setup lang="ts">
import type { Task } from '@nasq/contracts'
import type { BoardStage } from '@/composables/boardStages'
import { PRIORITY_LABEL_KEY } from '@/composables/taskState'
import DeadlineBadge from './DeadlineBadge.vue'

const props = withDefaults(defineProps<{ task: Task; stages: BoardStage[]; currentStageId: number | null; showProject?: boolean }>(), {
  showProject: true,
})
const emit = defineEmits<{
  open: [id: number]
  move: [stage: BoardStage]
}>()

const { t } = useI18n()

// Same short-initials rule as the activity timeline (Timeline.vue): first
// letter of up to the first two words, uppercased.
function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (!parts.length) return '?'
  return parts
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join('')
}

// Only priority '2'/'3' (high/urgent) get a visible flag — a normal/important
// card stays quiet. The card's start-side rail (nasq-ui-task-card) repeats the
// same two priorities in colour; the flag carries the accessible name.
const PRIORITY_TONE: Record<string, string> = {
  '2': 'text-priority-high',
  '3': 'text-priority-urgent',
}

// Hairline card with a priority rail; the move menu stays quiet until the card
// is hovered or focused (always visible on touch, see components.css).
const moveItems = computed(() => props.stages.map((stage) => ({
  label: stage.name,
  disabled: props.currentStageId === stage.id,
  onSelect: () => emit('move', stage),
})))

function onCardClick(event: MouseEvent) {
  const target = event.target as HTMLElement
  if (target.closest('button, [role="menu"], [data-state]')) return
  emit('open', props.task.id)
}

function onCardKeydown(event: KeyboardEvent) {
  if (event.key !== 'Enter' && event.key !== ' ') return
  const target = event.target as HTMLElement
  if (target.closest('button, [role="menu"]')) return
  event.preventDefault()
  emit('open', props.task.id)
}
</script>

<template>
  <div
    :data-testid="`board-card-${task.id}`"
    :data-task-id="task.id"
    :data-readonly="!task.can_write"
    :data-priority="task.priority"
    data-row
    role="button"
    tabindex="0"
    class="nasq-ui-record-surface nasq-ui-task-card shrink-0 cursor-pointer space-y-2 px-3 py-2.5 transition-colors hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring"
    @click="onCardClick"
    @keydown="onCardKeydown"
  >
    <div class="flex items-start justify-between gap-2">
      <p class="line-clamp-2 text-sm font-medium leading-5">{{ task.name }}</p>
      <div class="nasq-ui-row-actions -me-1.5 -mt-1">
        <UDropdownMenu v-if="task.can_write" :items="moveItems" :content="{ align: 'end' }">
          <UButton
            type="button"
            square
            size="xs"
            color="neutral"
            variant="ghost"
            icon="i-lucide-more-horizontal"
            :aria-label="t('tasks.detail.menu')"
            @click.stop
          />
        </UDropdownMenu>
      </div>
    </div>

    <p v-if="showProject && task.project" class="truncate text-xs text-muted">{{ task.project.name }}</p>

    <div class="flex items-center justify-between gap-2">
      <div class="flex items-center gap-1.5">
        <DeadlineBadge :deadline="task.date_deadline" :days-remaining="task.days_remaining" :is-closed="task.is_closed" />
        <UIcon
          name="i-lucide-flag"
          v-if="PRIORITY_TONE[task.priority]"
          role="img"
          :aria-hidden="false"
          class="size-3.5"
          :class="PRIORITY_TONE[task.priority]"
          :aria-label="t(PRIORITY_LABEL_KEY[task.priority as '0' | '1' | '2' | '3'])"
          :title="t(PRIORITY_LABEL_KEY[task.priority as '0' | '1' | '2' | '3'])"
        />
      </div>
      <div class="flex">
        <UAvatar v-for="a in task.assignees" :key="a.id" :text="initials(a.name)" class="-ms-1.5 size-5 border-2 border-default text-[10px] first:ms-0" />
      </div>
    </div>
  </div>
</template>
