<script setup lang="ts">
import type { TaskDetail } from '@liwan/contracts'
import { useUpdateTask } from '@/composables/useTasks'

// The record's title: plain text that edits in place (`SharedInlineText`). The write is the one the properties use,
// so the detail cache is patched optimistically and rolled back on failure.
const props = defineProps<{ task: TaskDetail }>()
const { t } = useI18n()
const { mutate: updateTask } = useUpdateTask()

function save(name: string) {
  if (props.task.can_write) updateTask({ id: props.task.id, patch: { name } })
}
</script>

<template>
  <SharedInlineText
    :model-value="task.name"
    :label="t('tasks.detail.editTitle')"
    :editable="task.can_write"
   
    input-test-id="task-title-input"
    input-class="w-[min(32rem,70vw)]"
    @save="save"
  />
</template>
