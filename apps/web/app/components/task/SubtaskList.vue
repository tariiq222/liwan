<script setup lang="ts">
import type { TaskDetail } from '@nasq/contracts'
import { useQueryClient } from '@tanstack/vue-query'
import { ApiError } from '@/composables/useApi'
import { taskKeys, useCreateTask } from '@/composables/useTasks'
import StateBadge from './StateBadge.vue'

const props = withDefaults(defineProps<{ task: TaskDetail; basePath?: string }>(), {
  basePath: '/tasks',
})

const { t } = useI18n()
const { can } = useAccess()
const hydrated = useHydrated()
const router = useRouter()
const route = useRoute()
const qc = useQueryClient()
const { mutateAsync, isPending } = useCreateTask()

const title = ref('')
const error = ref<string | null>(null)

async function addSubtask() {
  error.value = null
  const name = title.value.trim()
  if (!name || !props.task.project) return
  try {
    await mutateAsync({ name, project_id: props.task.project.id, parent_id: props.task.id })
    title.value = ''
    qc.invalidateQueries({ queryKey: taskKeys.detail(props.task.id) })
  } catch (e) {
    error.value = e instanceof ApiError ? e.message : t('errors.generic')
  }
}

function openSubtask(id: number) {
  router.push({ path: `${props.basePath}/${id}`, query: route.query })
}
</script>

<template>
  <div>
    <ul v-if="task.subtasks.length" class="task-list">
      <li v-for="sub in task.subtasks" :key="sub.id" class="task-subtask-row">
        <button type="button" class="flex min-w-0 flex-1 items-center gap-2 rounded-lg text-start" :disabled="!hydrated" @click="openSubtask(sub.id)">
          <StateBadge :state="sub.state" />
          <span class="flex-1 truncate text-sm">{{ sub.name }}</span>
        </button>
      </li>
    </ul>
    <p v-else class="task-empty-inline">{{ t('tasks.detail.noSubtasks') }}</p>
    <form v-if="can('pmo.tasks.create') && task.can_write" class="task-inline-form" @submit.prevent="addSubtask">
      <Input v-model="title" :placeholder="t('tasks.drawer.addSubtask')" class="h-8" />
      <Button type="submit" size="sm" variant="outline" :disabled="!hydrated || isPending || !title.trim()">{{ t('app.create') }}</Button>
    </form>
    <p v-if="error" role="alert" class="text-sm text-destructive">{{ error }}</p>
  </div>
</template>

<style scoped>
.task-list {
  display: grid;
  gap: 4px;
}

.task-subtask-row {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 9px;
  border: 1px solid transparent;
  border-radius: 8px;
  padding: 3px;
  transition: background-color 120ms ease, border-color 120ms ease;
}

.task-subtask-row:hover {
  border-color: var(--border);
  background: var(--muted);
}

.task-subtask-row:focus-within {
  border-color: var(--ring);
}

.task-inline-form {
  display: flex;
  align-items: end;
  gap: 8px;
  margin-top: 12px;
}

.task-inline-form > :first-child {
  min-width: 0;
  flex: 1;
}

.task-empty-inline {
  padding: 10px 0;
  color: var(--muted-foreground);
  font-size: 0.75rem;
}

@media (max-width: 600px) {
  .task-inline-form {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: stretch;
  }
}
</style>
