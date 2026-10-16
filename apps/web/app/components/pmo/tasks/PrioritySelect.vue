<script setup lang="ts">
import type { Task } from '@webvue/contracts'
import { PRIORITY_LABEL_KEY } from '@/composables/taskState'
import { useUpdateTask } from '@/composables/useTasks'

// Ruling: priority has four values, so this is a compact Select (not the
// brief's star toggle). Owns its own optimistic mutation — useUpdateTask
// already rolls back on error, so there is nothing else to wire up here.
// `soft` suits a table cell; a form beside outlined fields passes `outline`.
const props = withDefaults(defineProps<{ task: Task; labelledby?: string; variant?: 'soft' | 'outline' }>(), { variant: 'soft' })

const { t } = useI18n()
const { mutate, isPending } = useUpdateTask()
// Rendered as a table cell that can be SSR-rendered with data already
// available, so the trigger is racy the same way as the other controls
// documented in README's "SSR hydration and interactive controls".
const hydrated = useHydrated()

const PRIORITIES = ['0', '1', '2', '3'] as const

const items = computed(() => PRIORITIES.map((p) => ({ label: t(PRIORITY_LABEL_KEY[p]), value: p })))

function onChange(value: unknown) {
  const priority = String(value) as (typeof PRIORITIES)[number]
  if (priority === props.task.priority) return
  mutate({ id: props.task.id, patch: { priority } })
}
</script>

<template>
  <span v-if="!task.can_write" class="text-sm font-medium text-highlighted">{{ t(PRIORITY_LABEL_KEY[task.priority]) }}</span>
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
