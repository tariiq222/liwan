<script setup lang="ts">
import type { TaskDetail, TaskState } from '@liwan/contracts'
import { useQueryClient } from '@tanstack/vue-query'
import { taskStateBadge } from '@/composables/taskState'
import { ApiError } from '@/composables/useApi'
import { taskKeys, useCreateTask } from '@/composables/useTasks'
import { badgeLabel } from '@liwan/ui/app/utils/statusBadge'
import RecordBlock from '../records/RecordBlock.vue'

// The task's sub-tasks: rows that open the sub-task keeping the query, and an inline row that adds one by name.
// The API creates a sub-task only inside a project (`project_id` is required), so a task without one gets no add row.
// The input stays open after an add so several can be typed in a row; Escape or leaving it empty closes it.
const props = withDefaults(defineProps<{ task: TaskDetail; basePath?: string }>(), {
  basePath: '/tasks',
})

const { t } = useI18n()
const stateBadge = (state: TaskState) => { const entry = taskStateBadge(state); return { tone: entry.tone, label: badgeLabel(entry, state, t) } }
const { can } = useAccess()
const hydrated = useHydrated()
const route = useRoute()
const qc = useQueryClient()
const { mutateAsync } = useCreateTask()

const adding = ref(false)
const pending = ref(false)
const name = ref('')
const error = ref('')
const input = useTemplateRef<{ inputRef?: HTMLInputElement | null }>('input')
const trigger = useTemplateRef<HTMLButtonElement>('trigger')

const canAdd = computed(() => !!props.task.project && can('pmo.tasks.create') && props.task.can_write)
const done = computed(() => props.task.subtasks.filter(sub => sub.is_closed).length)

function open() {
  if (!hydrated.value) return
  adding.value = true
  nextTick(() => input.value?.inputRef?.focus())
}

function close() {
  adding.value = false
  name.value = ''
  error.value = ''
  nextTick(() => trigger.value?.focus())
}

async function submit() {
  const title = name.value.trim()
  if (pending.value || !props.task.project) return
  if (!title) return close()
  pending.value = true
  error.value = ''
  try {
    await mutateAsync({ name: title, project_id: props.task.project.id, parent_id: props.task.id })
    qc.invalidateQueries({ queryKey: taskKeys.detail(props.task.id) })
    name.value = ''
    nextTick(() => input.value?.inputRef?.focus())
  } catch (e) {
    error.value = e instanceof ApiError ? e.message : t('errors.generic')
  } finally {
    pending.value = false
  }
}

function onBlur() {
  if (!pending.value && !name.value.trim() && !error.value) adding.value = false
}
</script>

<template>
  <RecordBlock data-testid="task-subtasks" :title="t('tasks.drawer.subtasks')" :count="task.subtasks.length ? t('tasks.detail.subtaskProgress', { done, total: task.subtasks.length }) : undefined">
    <ul v-if="task.subtasks.length" class="divide-y divide-default">
      <li v-for="sub in task.subtasks" :key="sub.id" class="flex min-w-0 items-center gap-3 py-2">
        <SharedStatusBadge v-bind="stateBadge(sub.state)" />
        <NuxtLink
          :to="{ path: `${props.basePath}/${sub.id}`, query: route.query }"
          class="min-w-0 flex-1 truncate text-sm text-highlighted hover:underline"
          :class="sub.is_closed ? 'text-muted line-through' : ''"
        >{{ sub.name }}</NuxtLink>
      </li>
    </ul>
    <p v-else-if="!canAdd" class="text-sm text-muted">{{ t('tasks.detail.noSubtasks') }}</p>

    <template v-if="canAdd">
      <form v-if="adding" class="flex items-center gap-2" @submit.prevent="submit">
        <UInput
          ref="input"
          v-model="name"
          :placeholder="t('tasks.drawer.addSubtask')"
          :aria-label="t('tasks.drawer.addSubtask')"
          size="sm"
          class="min-w-0 flex-1"
          :disabled="pending"
          data-testid="subtask-input"
          @keydown.escape.stop.prevent="close"
          @blur="onBlur"
        />
      </form>
      <button
        v-else
        ref="trigger"
        type="button"
        data-testid="subtask-add"
        class="-mx-1.5 inline-flex w-fit items-center gap-1.5 rounded-inner px-1.5 py-1 text-sm text-muted transition-colors hover:bg-elevated hover:text-default focus-visible:outline-2 focus-visible:outline-primary motion-reduce:transition-none"
        :disabled="!hydrated"
        @click="open"
      >
        <UIcon name="i-lucide-plus" class="size-4" aria-hidden="true" />{{ t('tasks.drawer.addSubtask') }}
      </button>
    </template>
    <p v-if="error" role="alert" class="text-sm text-error">{{ error }}</p>
  </RecordBlock>
</template>
