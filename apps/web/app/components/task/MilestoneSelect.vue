<script setup lang="ts">
import type { TaskDetail } from '@nasq/contracts'
import { useMilestones } from '@/composables/useMilestones'
import { useUpdateTask } from '@/composables/useTasks'
import { validateTaskDates } from '@/utils/projectDateBounds'

// Owns its own optimistic mutation, same as PrioritySelect — useUpdateTask
// already rolls back on error, so there is nothing else to wire up here.
// Rendered only when `task.project` exists (guarded by the caller), but the
// project id is still read defensively via optional chaining.
const props = defineProps<{ task: TaskDetail; labelledby?: string }>()

const { t } = useI18n()
const hydrated = useHydrated()
const { mutate, isPending } = useUpdateTask()
const validationError = ref<string | null>(null)

const projectId = computed(() => props.task.project?.id ?? null)
const { data: milestones } = useMilestones(projectId)

const NONE = 'none'

const items = computed(() => [
  { label: t('tasks.drawer.noMilestone'), value: NONE },
  ...(milestones.value ?? []).map((m) => ({ label: m.name, value: String(m.id) })),
])

function onChange(value: unknown) {
  validationError.value = null
  if (value === NONE) {
    mutate({ id: props.task.id, patch: { milestone_id: null }, resolved: { milestone: null } })
    return
  }
  const id = Number(value)
  const milestone = (milestones.value ?? []).find((m) => m.id === id)
  if (!milestone) return
  const boundsError = validateTaskDates({
    milestoneStart: milestone.start_date,
    milestoneDeadline: milestone.deadline,
    plannedStart: props.task.planned_start,
    dateDeadline: props.task.date_deadline,
  })
  if (boundsError) {
    validationError.value = t(`tasks.schedule.${boundsError.split('.').pop()}`)
    return
  }
  mutate({ id: props.task.id, patch: { milestone_id: id }, resolved: { milestone: { id: milestone.id, name: milestone.name } } })
}
</script>

<template>
  <USelect
    size="sm"
    class="w-full"
    data-testid="milestone-select"
    :items="items"
    :model-value="task.milestone ? String(task.milestone.id) : NONE"
    :disabled="isPending || !hydrated"
    :aria-labelledby="props.labelledby"
    @update:model-value="onChange"
  />
  <p v-if="validationError" role="alert" class="mt-1 text-xs text-error">{{ validationError }}</p>
</template>
