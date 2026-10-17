<script setup lang="ts">
import type { Task } from '@webvue/contracts'
import { statusPillAttrs } from '@webvue/ui/app/utils/statusPill'
import { PRIORITY_LABEL_KEY, PRIORITY_TONE } from '@/composables/taskState'
import { useUpdateTask } from '@/composables/useTasks'

// Ruling: priority has four values, so this is a compact Select (not the
// brief's star toggle). Owns its own optimistic mutation — useUpdateTask
// already rolls back on error, so there is nothing else to wire up here.
// `soft` suits a compact row; a form beside outlined fields passes `outline`. `badge` is the task table's cell: a
// tinted pill with a small icon per priority that looks read-only and still opens the same menu.
const props = withDefaults(defineProps<{ task: Task; labelledby?: string; variant?: 'soft' | 'outline' | 'badge' }>(), { variant: 'soft' })

const { t } = useI18n()
const { mutate, isPending } = useUpdateTask()
// Rendered as a table cell that can be SSR-rendered with data already
// available, so the trigger is racy the same way as the other controls
// documented in README's "SSR hydration and interactive controls".
const hydrated = useHydrated()

const PRIORITIES = ['0', '1', '2', '3'] as const
const BADGE = {
  '0': { icon: 'i-lucide-minus', tone: PRIORITY_TONE['0'] },
  '1': { icon: 'i-lucide-chevron-up', tone: PRIORITY_TONE['1'] },
  '2': { icon: 'i-lucide-chevrons-up', tone: PRIORITY_TONE['2'] },
  '3': { icon: 'i-lucide-flame', tone: PRIORITY_TONE['3'] },
} as const

const items = computed(() => PRIORITIES.map((p) => ({ label: t(PRIORITY_LABEL_KEY[p]), value: p })))

function onChange(value: unknown) {
  const priority = String(value) as (typeof PRIORITIES)[number]
  if (priority === props.task.priority) return
  mutate({ id: props.task.id, patch: { priority } })
}
</script>

<template>
  <span v-if="!task.can_write && props.variant === 'badge'" v-bind="statusPillAttrs(BADGE[task.priority].tone)" class="min-w-25 justify-center" data-testid="priority-badge">
    <UIcon :name="BADGE[task.priority].icon" class="size-3.5" aria-hidden="true" />{{ t(PRIORITY_LABEL_KEY[task.priority]) }}
  </span>
  <span v-else-if="!task.can_write" class="text-sm font-medium text-highlighted">{{ t(PRIORITY_LABEL_KEY[task.priority]) }}</span>
  <USelect
    v-else-if="props.variant === 'badge'"
    size="xs"
    variant="none"
    class="w-fit"
    :icon="BADGE[task.priority].icon"
    :ui="{ base: 'webvue-pill min-w-25 w-fit justify-center ps-2.5 pe-2.5 focus:outline-none', trailing: 'hidden', leading: 'static inset-auto flex items-center p-0', leadingIcon: 'size-3.5 text-current' }"
    :data-tone="BADGE[task.priority].tone"
    data-interactive
    :items="items"
    :model-value="task.priority"
    :aria-label="t('tasks.columns.priority')"
    :disabled="isPending || !hydrated"
    :aria-labelledby="props.labelledby"
    data-testid="priority-badge"
    @update:model-value="onChange"
  />
  <USelect
    v-else
    size="sm"
    :variant="props.variant"
    class="w-full"
    :items="items"
    :model-value="task.priority"
    :aria-label="t('tasks.columns.priority')"
    :disabled="isPending || !hydrated"
    :aria-labelledby="props.labelledby"
    @update:model-value="onChange"
  />
</template>
