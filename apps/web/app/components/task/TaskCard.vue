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
// card stays quiet, matching the badge vocabulary elsewhere (deadline tones,
// state colors) of reserving color for things that need attention.
const PRIORITY_TONE: Record<string, string> = {
  '2': 'text-brand-link',
  '3': 'text-error',
}

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
  <UCard
    :data-testid="`board-card-${task.id}`"
    :data-task-id="task.id"
    :data-readonly="!task.can_write"
    role="button"
    tabindex="0"
    :ui="{ body: 'space-y-2 px-3 py-3' }"
    class="shrink-0 cursor-pointer gap-2 transition-colors hover:ring-brand-border"
    @click="onCardClick"
    @keydown="onCardKeydown"
  >
    <div class="flex items-start justify-between gap-2">
      <p class="line-clamp-2 text-sm font-medium">{{ task.name }}</p>
      <UDropdownMenu v-if="task.can_write" :items="moveItems" :content="{ align: 'end' }">
        <UButton
          type="button"
          square
          color="neutral"
          variant="outline"
          icon="i-lucide-more-horizontal"
          :aria-label="t('tasks.detail.menu')"
          @click.stop
        />
      </UDropdownMenu>
    </div>

    <p v-if="showProject && task.project" class="truncate text-xs text-muted">{{ task.project.name }}</p>

    <div class="flex items-center justify-between gap-2 pt-1">
      <div class="flex items-center gap-2">
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
        <UAvatar v-for="a in task.assignees" :key="a.id" :text="initials(a.name)" class="-ms-2 size-6 border-2 border-default text-xs first:ms-0" />
      </div>
    </div>
  </UCard>
</template>
