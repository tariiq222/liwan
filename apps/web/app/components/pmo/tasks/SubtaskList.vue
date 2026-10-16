<script setup lang="ts">
import type { TaskDetail, TaskState } from '@nasq/contracts'
import { useQueryClient } from '@tanstack/vue-query'
import { taskStateBadge } from '@/composables/taskState'
import { ApiError } from '@/composables/useApi'
import { taskKeys, useCreateTask } from '@/composables/useTasks'
import { badgeLabel } from '@nasq/ui/app/utils/statusBadge'

// The project task's wiring of `SharedChecklist`: rows open the sub-task keeping the query.
const props = withDefaults(defineProps<{ task: TaskDetail; basePath?: string }>(), {
  basePath: '/tasks',
})

const { t } = useI18n()
const stateBadge = (state: TaskState) => { const entry = taskStateBadge(state); return { tone: entry.tone, label: badgeLabel(entry, state, t) } }
const { can } = useAccess()
const route = useRoute()
const qc = useQueryClient()
const { mutateAsync } = useCreateTask()

const error = ref('')
const items = computed(() => props.task.subtasks.map(sub => ({
  id: sub.id,
  name: sub.name,
  to: { path: `${props.basePath}/${sub.id}`, query: route.query },
})))
const statesById = computed(() => new Map(props.task.subtasks.map(sub => [sub.id, sub.state])))

async function addSubtask(name: string) {
  error.value = ''
  if (!props.task.project) return false
  try {
    await mutateAsync({ name, project_id: props.task.project.id, parent_id: props.task.id })
    qc.invalidateQueries({ queryKey: taskKeys.detail(props.task.id) })
    return true
  } catch (e) {
    error.value = e instanceof ApiError ? e.message : t('errors.generic')
    return false
  }
}
</script>

<template>
  <SharedChecklist
    :items="items"
    :empty-text="t('tasks.detail.noSubtasks')"
    :add-placeholder="t('tasks.drawer.addSubtask')"
    :add-label="t('app.create')"
    :add="addSubtask"
    :can-add="can('pmo.tasks.create') && task.can_write"
    :error="error"
  >
    <template #leading="{ item }">
      <SharedStatusBadge v-bind="stateBadge(statesById.get(item.id)!)" />
    </template>
  </SharedChecklist>
</template>
