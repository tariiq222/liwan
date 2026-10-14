<script setup lang="ts">
import type { TaskState } from '@nasq/contracts'
import { taskStateBadge } from '@/composables/taskState'
import { badgeLabel } from '@/utils/statusBadge'
import type { TaskDetail } from '@nasq/contracts'
import { useQueryClient } from '@tanstack/vue-query'
import { ApiError } from '@/composables/useApi'
import { taskKeys, useCreateTask } from '@/composables/useTasks'

const props = withDefaults(defineProps<{ task: TaskDetail; basePath?: string }>(), {
  basePath: '/tasks',
})

const { t } = useI18n()
const stateBadge = (state: TaskState) => { const entry = taskStateBadge(state); return { tone: entry.tone, label: badgeLabel(entry, state, t) } }
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
    <ul v-if="task.subtasks.length" class="grid gap-1">
      <li v-for="sub in task.subtasks" :key="sub.id" class="flex min-w-0 items-center gap-2 rounded-lg border border-transparent p-0.5 transition-colors hover:border-default hover:bg-elevated focus-within:border-primary">
        <UButton type="button" color="neutral" variant="ghost" class="flex min-w-0 flex-1 items-center justify-start gap-2 rounded-lg text-start" :disabled="!hydrated" @click="openSubtask(sub.id)">
          <SharedStatusBadge v-bind="stateBadge(sub.state)" />
          <span class="flex-1 truncate text-sm">{{ sub.name }}</span>
        </UButton>
      </li>
    </ul>
    <p v-else class="py-2 text-sm text-muted">{{ t('tasks.detail.noSubtasks') }}</p>
    <form v-if="can('pmo.tasks.create') && task.can_write" class="mt-3 flex items-end gap-2" @submit.prevent="addSubtask">
      <UInput v-model="title" :placeholder="t('tasks.drawer.addSubtask')" :aria-label="t('tasks.drawer.addSubtask')" size="sm" class="min-w-0 flex-1" :disabled="!hydrated || isPending" />
      <UButton type="submit" size="sm" variant="outline" :loading="isPending" :disabled="!hydrated || isPending || !title.trim()">{{ t('app.create') }}</UButton>
    </form>
    <p v-if="error" role="alert" class="mt-2 text-sm text-error">{{ error }}</p>
  </div>
</template>
