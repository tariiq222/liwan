<script setup lang="ts">
import type { Task } from '@nasq/contracts'
import { PRIORITY_LABEL_KEY } from '@/composables/taskState'
import { useUpdateTask } from '@/composables/useTasks'

// Ruling: priority has four values, so this is a compact Select (not the
// brief's star toggle). Owns its own optimistic mutation — useUpdateTask
// already rolls back on error, so there is nothing else to wire up here.
const props = defineProps<{ task: Task }>()

const { t } = useI18n()
const { mutate, isPending } = useUpdateTask()

const PRIORITIES = ['0', '1', '2', '3'] as const

function onChange(value: unknown) {
  const priority = String(value) as (typeof PRIORITIES)[number]
  if (priority === props.task.priority) return
  mutate({ id: props.task.id, patch: { priority } })
}
</script>

<template>
  <Select :model-value="task.priority" @update:model-value="onChange">
    <SelectTrigger size="sm" class="w-full" :disabled="isPending">
      <SelectValue />
    </SelectTrigger>
    <SelectContent>
      <SelectItem v-for="p in PRIORITIES" :key="p" :value="p">{{ t(PRIORITY_LABEL_KEY[p]) }}</SelectItem>
    </SelectContent>
  </Select>
</template>
