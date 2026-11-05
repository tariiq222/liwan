<script setup lang="ts">
import type { TaskDetail } from '@liwan/contracts'
import { useUpdateTask } from '@/composables/useTasks'

// The record's heading carries its own edit control: the name reads as text and a pencil turns it into
// the one field. Enter or leaving the field saves, Escape puts the saved name back. The same write the
// properties use, so the detail cache is patched optimistically and rolled back on failure.
const props = defineProps<{ task: TaskDetail }>()
const { t } = useI18n()
const hydrated = useHydrated()
const { mutate: updateTask } = useUpdateTask()

const editing = ref(false)
const input = useTemplateRef<{ inputRef?: HTMLInputElement | null }>('input')
const draft = ref(props.task.name)

watch(() => props.task.name, (name) => {
  if (!editing.value) draft.value = name
})
watch(() => props.task.id, () => {
  editing.value = false
  draft.value = props.task.name
})

function startEdit() {
  if (!hydrated.value || !props.task.can_write) return
  draft.value = props.task.name
  editing.value = true
  nextTick(() => input.value?.inputRef?.focus())
}

function save() {
  if (!editing.value) return
  editing.value = false
  if (!props.task.can_write) return
  const name = draft.value.trim()
  if (!name || name === props.task.name) {
    draft.value = props.task.name
    return
  }
  updateTask({ id: props.task.id, patch: { name } }, {
    onError: () => { draft.value = props.task.name },
  })
}

function cancel() {
  draft.value = props.task.name
  editing.value = false
}
</script>

<template>
  <span class="flex min-w-0 items-center gap-1.5">
    <UInput
      v-if="editing"
      ref="input"
      v-model="draft"
      data-testid="task-title-input"
      size="md"
      class="min-w-0 w-full"
      :aria-label="t('tasks.newTitle')"
      @blur="save"
      @keydown.enter.prevent="save"
      @keydown.escape.stop.prevent="cancel"
    />
    <template v-else>
      <span class="min-w-0 wrap-anywhere">{{ task.name }}</span>
      <UButton
        v-if="task.can_write"
        type="button"
        color="neutral"
        variant="ghost"
        size="xs"
        square
        icon="i-lucide-pencil"
        class="shrink-0"
        :disabled="!hydrated"
        :aria-label="t('tasks.detail.editTitle')"
        @click="startEdit"
      />
    </template>
  </span>
</template>
