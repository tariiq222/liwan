<script setup lang="ts">
import type { PersonalTask } from '@webvue/contracts'
import { ApiError } from '@/composables/useApi'
import { useCreateMyTask, useMyTaskTransition } from '@/composables/useMyTasks'

// The personal task's wiring of `SharedChecklist`. Depth 1: the page renders this section only for
// a task that has no parent. A sub-task is a full personal task, so each row links to its own
// page; the toggle goes through the same transition endpoints as the page buttons and waits for
// the server (no optimistic update).
const props = withDefaults(defineProps<{ task: PersonalTask; disabled?: boolean; discardDraftKey?: number }>(), { disabled: false, discardDraftKey: 0 })
const emit = defineEmits<{ 'draft-change': [dirty: boolean]; 'pending-change': [pending: boolean] }>()
const draft = ref('')
watch(draft, value => emit('draft-change', !!value.trim()), { flush: 'sync' })
watch(() => props.discardDraftKey, () => { draft.value = '' })
onBeforeUnmount(() => { emit('draft-change', false); emit('pending-change', false) })
let activeOperations = 0

const { t } = useI18n()
const route = useRoute()
const { mutateAsync: create } = useCreateMyTask()
const { mutateAsync: transition } = useMyTaskTransition()

const error = ref('')
const progress = computed(() => ({ done: props.task.subtasks.filter(item => item.state === 'done').length, total: props.task.subtasks.length, cancelled: props.task.subtasks.filter(item => item.state === 'cancelled').length }))
const canWrite = computed(() => props.task.allowed_actions.write && !props.disabled)
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
  emit('pending-change', ++activeOperations > 0)
  error.value = ''
  try {
    await create({ name, parent_id: props.task.id })
    return true
  } catch (e) {
    error.value = e instanceof ApiError ? e.message : t('myTasks.errors.save')
    return false
  } finally { emit('pending-change', --activeOperations > 0) }
}

async function toggle(item: { id: number; done?: boolean }) {
  emit('pending-change', ++activeOperations > 0)
  error.value = ''
  try {
    await transition({ id: item.id, action: item.done ? 'reopen' : 'done' })
  } catch (e) {
    error.value = e instanceof ApiError ? e.message : t('myTasks.errors.transition')
  } finally { emit('pending-change', --activeOperations > 0) }
}
</script>

<template>
  <SharedRecordSection data-testid="my-task-subtasks" :title="t('myTasks.subtasks.title')">
    <template #actions>
      <span v-if="progress.total" class="text-xs text-muted"><span data-testid="my-task-subtasks-progress">{{ t('myTasks.subtasks.progress', progress) }}</span><span v-if="progress.cancelled"> · {{ t('myTasks.subtasks.cancelledCount', { count: progress.cancelled }) }}</span></span>
    </template>
    <SharedChecklist
      v-model:draft="draft"
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
