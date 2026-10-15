<script setup lang="ts">
import type { PersonalTask } from '@nasq/contracts'
import { ApiError } from '@/composables/useApi'
import { useCreateMyTask, useMyTaskTransition } from '@/composables/useMyTasks'

// The personal task's wiring of `SharedChecklist`. Depth 1: the page renders this section only for
// a task that has no parent. A sub-task is a full personal task, so each row links to its own
// page; the toggle goes through the same transition endpoints as the page buttons and waits for
// the server (no optimistic update).
const props = defineProps<{ task: PersonalTask }>()

const { t } = useI18n()
const route = useRoute()
const { mutateAsync: create } = useCreateMyTask()
const { mutateAsync: transition } = useMyTaskTransition()

const error = ref('')
const canWrite = computed(() => props.task.allowed_actions.write)
const items = computed(() => props.task.subtasks.map((sub) => {
  const open = sub.state === 'open'
  return {
    id: sub.id,
    name: sub.name,
    to: { path: `/my-tasks/${sub.id}`, query: { returnTo: route.fullPath } },
    done: !open,
    cancelledLabel: sub.state === 'cancelled' ? t('myTasks.state.cancelled') : undefined,
    toggleLabel: open ? t('myTasks.actions.done') : t('myTasks.actions.reopen'),
    toggleIcon: open ? 'i-lucide-check' : 'i-lucide-rotate-ccw',
  }
}))

async function add(name: string) {
  error.value = ''
  try {
    await create({ name, parent_id: props.task.id })
    return true
  } catch (e) {
    error.value = e instanceof ApiError ? e.message : t('myTasks.errors.save')
    return false
  }
}

async function toggle(item: { id: number; done?: boolean }) {
  error.value = ''
  try {
    await transition({ id: item.id, action: item.done ? 'reopen' : 'done' })
  } catch (e) {
    error.value = e instanceof ApiError ? e.message : t('myTasks.errors.transition')
  }
}
</script>

<template>
  <SharedRecordSection data-testid="my-task-subtasks" :title="t('myTasks.subtasks.title')">
    <SharedChecklist
      :items="items"
      :empty-text="t('myTasks.subtasks.empty')"
      :add-placeholder="t('myTasks.subtasks.namePlaceholder')"
      :add-label="t('myTasks.subtasks.add')"
      :add="add"
      :toggle="canWrite ? toggle : undefined"
      :can-add="canWrite"
      :done-label="t('myTasks.state.done')"
      :error="error"
    />
  </SharedRecordSection>
</template>
