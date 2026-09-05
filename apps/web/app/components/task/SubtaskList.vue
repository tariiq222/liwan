<script setup lang="ts">
import type { TaskDetail } from '@nasq/contracts'
import { useQueryClient } from '@tanstack/vue-query'
import { ApiError } from '@/composables/useApi'
import { taskKeys, useCreateTask } from '@/composables/useTasks'
import StateBadge from './StateBadge.vue'

const props = defineProps<{ task: TaskDetail }>()

const { t } = useI18n()
const { can } = useAccess()
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
  router.push({ path: `/tasks/${id}`, query: route.query })
}
</script>

<template>
  <div class="space-y-2">
    <ul v-if="task.subtasks.length" class="space-y-1">
      <li
        v-for="sub in task.subtasks"
        :key="sub.id"
        class="flex cursor-pointer items-center gap-2 rounded-md p-1.5 text-sm hover:bg-muted"
        @click="openSubtask(sub.id)"
      >
        <StateBadge :state="sub.state" />
        <span class="flex-1 truncate">{{ sub.name }}</span>
      </li>
    </ul>
    <form v-if="can('pmo.tasks.create') && task.can_write" class="flex gap-2" @submit.prevent="addSubtask">
      <Input v-model="title" :placeholder="t('tasks.drawer.addSubtask')" class="h-8" />
      <Button type="submit" size="sm" :disabled="isPending || !title.trim()">{{ t('app.create') }}</Button>
    </form>
    <p v-if="error" role="alert" class="text-sm text-destructive">{{ error }}</p>
  </div>
</template>
