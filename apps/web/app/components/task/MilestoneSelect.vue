<script setup lang="ts">
import type { TaskDetail } from '@nasq/contracts'
import { useMilestones } from '@/composables/useMilestones'
import { useUpdateTask } from '@/composables/useTasks'

// Owns its own optimistic mutation, same as PrioritySelect — useUpdateTask
// already rolls back on error, so there is nothing else to wire up here.
// Rendered only when `task.project` exists (guarded by the caller), but the
// project id is still read defensively via optional chaining.
const props = defineProps<{ task: TaskDetail }>()

const { t } = useI18n()
const hydrated = useHydrated()
const { mutate, isPending } = useUpdateTask()

const projectId = computed(() => props.task.project?.id ?? null)
const { data: milestones } = useMilestones(projectId)

const NONE = 'none'

function onChange(value: unknown) {
  if (value === NONE) {
    mutate({ id: props.task.id, patch: { milestone_id: null }, resolved: { milestone: null } })
    return
  }
  const id = Number(value)
  const milestone = (milestones.value ?? []).find((m) => m.id === id)
  if (!milestone) return
  mutate({ id: props.task.id, patch: { milestone_id: id }, resolved: { milestone: { id: milestone.id, name: milestone.name } } })
}
</script>

<template>
  <Select :model-value="task.milestone ? String(task.milestone.id) : NONE" :disabled="isPending || !hydrated" @update:model-value="onChange">
    <SelectTrigger size="sm" class="w-full" data-testid="milestone-select" :disabled="isPending || !hydrated">
      <SelectValue />
    </SelectTrigger>
    <SelectContent>
      <SelectItem :value="NONE">{{ t('tasks.drawer.noMilestone') }}</SelectItem>
      <SelectItem v-for="m in milestones ?? []" :key="m.id" :value="String(m.id)">{{ m.name }}</SelectItem>
    </SelectContent>
  </Select>
</template>
