<script setup lang="ts">
import type { TaskDetail } from '@nasq/contracts'
import { ApiError } from '@/composables/useApi'
import { useUpdateTask } from '@/composables/useTasks'

const props = defineProps<{ task: TaskDetail }>()
const { t } = useI18n()
const hydrated = useHydrated()
const { mutateAsync, isPending } = useUpdateTask()
const saving = ref(false)
const error = ref<string | null>(null)

const deliverables = computed(() => props.task.deliverables)
const busy = computed(() => saving.value || isPending.value)

async function toggle(index: number, event: Event) {
  if (!hydrated.value || !props.task.can_write || busy.value) return
  const current = deliverables.value[index]
  if (!current) return

  // Native checkbox controls flip before change handlers run. Hold the
  // rendered state at the cached value until the server response arrives.
  const input = event.currentTarget as HTMLInputElement | null
  if (input) input.checked = current.done

  error.value = null
  saving.value = true
  const next = deliverables.value.map((item, itemIndex) => itemIndex === index
    ? { name: item.name, done: !item.done }
    : { name: item.name, done: item.done })
  try {
    // useUpdateTask replaces the detail cache with the full server response;
    // this component deliberately waits for that response before unlocking.
    await mutateAsync({ id: props.task.id, patch: { deliverables: next } })
  } catch (cause) {
    error.value = cause instanceof ApiError ? cause.message : t('errors.generic')
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <section v-if="deliverables.length" class="nasq-panel" data-testid="task-deliverables" aria-labelledby="task-deliverables-title">
    <header class="nasq-panel-header">
      <h2 id="task-deliverables-title">{{ t('tasks.deliverables.title') }}</h2>
      <span class="text-xs text-muted-foreground">{{ t('tasks.deliverables.checklistOf', { done: deliverables.filter(item => item.done).length, total: deliverables.length }) }}</span>
    </header>
    <div class="nasq-panel-body grid gap-3">
    <div class="space-y-2">
      <label v-for="(item, index) in deliverables" :key="`${task.id}-${index}`" class="flex items-center gap-2 text-sm" :class="{ 'cursor-pointer': task.can_write && hydrated && !busy }">
        <input :checked="item.done" type="checkbox" :aria-label="t('tasks.deliverables.toggle', { name: item.name })" :disabled="!hydrated || !task.can_write || busy" class="size-4 rounded border-border accent-primary" @change="toggle(index, $event)" />
        <span :class="{ 'text-muted-foreground line-through': item.done }">{{ item.name }}</span>
      </label>
    </div>
    <p v-if="error" role="alert" class="text-sm text-destructive">{{ error }}</p>
    </div>
  </section>
</template>
