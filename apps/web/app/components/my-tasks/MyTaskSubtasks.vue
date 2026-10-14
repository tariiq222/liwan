<script setup lang="ts">
import type { PersonalTask } from '@nasq/contracts'
import { ApiError } from '@/composables/useApi'
import { useCreateMyTask, useMyTaskTransition } from '@/composables/useMyTasks'

// Depth 1: the page renders this section only for a task that has no parent. A sub-task is a full
// personal task, so each row links to its own page; the toggle goes through the same transition
// endpoints as the page buttons and waits for the server (no optimistic update).
const props = defineProps<{ task: PersonalTask }>()

const { t } = useI18n()
const route = useRoute()
const hydrated = useHydrated()
const { mutateAsync: create, isPending: creating } = useCreateMyTask()
const { mutateAsync: transition, isPending: toggling } = useMyTaskTransition()

const name = ref('')
const error = ref('')
const busyId = ref<number | null>(null)

const returnTo = computed(() => ({ returnTo: route.fullPath }))
const canWrite = computed(() => props.task.allowed_actions.write)
const failure = (e: unknown) => (e instanceof ApiError ? e.message : t('myTasks.errors.save'))

// Plain flags set before the first await: `isPending` of a mutation reaches a guard a macrotask late.
let adding = false
let switching = false

async function add() {
  const title = name.value.trim()
  if (adding || !title || creating.value) return
  adding = true
  error.value = ''
  try {
    await create({ name: title, parent_id: props.task.id })
    name.value = ''
  } catch (e) {
    error.value = failure(e)
  } finally {
    adding = false
  }
}

async function toggle(sub: PersonalTask['subtasks'][number]) {
  if (switching || toggling.value) return
  switching = true
  error.value = ''
  busyId.value = sub.id
  try {
    await transition({ id: sub.id, action: sub.state === 'open' ? 'done' : 'reopen' })
  } catch (e) {
    error.value = e instanceof ApiError ? e.message : t('myTasks.errors.transition')
  } finally {
    busyId.value = null
    switching = false
  }
}
</script>

<template>
  <SharedRecordSection data-testid="my-task-subtasks" :title="t('myTasks.subtasks.title')">
    <ul v-if="task.subtasks.length" class="divide-y divide-default">
      <li v-for="sub in task.subtasks" :key="sub.id" class="flex min-w-0 items-center gap-3 py-2">
        <NuxtLink
          :to="{ path: `/my-tasks/${sub.id}`, query: returnTo }"
          class="min-w-0 flex-1 truncate text-sm text-highlighted hover:underline"
          :class="sub.state !== 'open' ? 'text-muted line-through' : ''"
        >{{ sub.name }}</NuxtLink>
        <UBadge v-if="sub.state === 'cancelled'" variant="subtle" color="neutral">{{ t('myTasks.state.cancelled') }}</UBadge>
        <UButton
          v-else-if="canWrite"
          type="button"
          size="xs"
          color="neutral"
          variant="outline"
          :icon="sub.state === 'open' ? 'i-lucide-check' : 'i-lucide-rotate-ccw'"
          :label="sub.state === 'open' ? t('myTasks.actions.done') : t('myTasks.actions.reopen')"
          :aria-label="`${sub.state === 'open' ? t('myTasks.actions.done') : t('myTasks.actions.reopen')}: ${sub.name}`"
          :loading="busyId === sub.id"
          :disabled="!hydrated || toggling"
          @click="toggle(sub)"
        />
        <UBadge v-else variant="subtle" color="success">{{ t('myTasks.state.done') }}</UBadge>
      </li>
    </ul>
    <p v-else class="py-2 text-sm text-muted">{{ t('myTasks.subtasks.empty') }}</p>

    <form v-if="canWrite" class="flex items-end gap-2" @submit.prevent="add">
      <UInput
        v-model="name"
        :placeholder="t('myTasks.subtasks.namePlaceholder')"
        :aria-label="t('myTasks.subtasks.namePlaceholder')"
        size="sm"
        class="min-w-0 flex-1"
        :disabled="!hydrated || creating"
      />
      <UButton type="submit" size="sm" variant="outline" :loading="creating" :disabled="!hydrated || creating || !name.trim()" :label="t('myTasks.subtasks.add')" />
    </form>
    <p v-if="error" role="alert" class="text-sm text-error">{{ error }}</p>
  </SharedRecordSection>
</template>
