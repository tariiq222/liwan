<script setup lang="ts">
import type { Task, TaskState } from '@nasq/contracts'
import { Loader2 } from '@lucide/vue'
import { STATE_LABEL_KEY } from '@/composables/taskState'
import { ApiError } from '@/composables/useApi'
import { useTransitionTask } from '@/composables/useTasks'
import StateBadge from './StateBadge.vue'

const props = defineProps<{ task: Task; canApprove?: boolean }>()

const { t } = useI18n()
const { mutate, isPending } = useTransitionTask()
const hydrated = useHydrated()
const toast = useToast()

const states = computed(() => props.task.allowed_transitions ?? [])

function onSelect(state: TaskState) {
  mutate(
    { id: props.task.id, state },
    {
      onError: (err) => {
        if (err instanceof ApiError && err.code === 'transition_forbidden') toast.add({ title: t('tasks.transition.forbidden'), color: 'error' })
        else if (err instanceof ApiError) toast.add({ title: err.message, color: 'error' })
        else toast.add({ title: t('errors.generic'), color: 'error' })
      },
    },
  )
}

const items = computed(() => states.value.map((s) => ({ label: t(STATE_LABEL_KEY[s]), onSelect: () => onSelect(s) })))
</script>

<template>
  <StateBadge v-if="!states.length" :state="task.state" />
  <UDropdownMenu v-else :items="items" :content="{ align: 'start' }">
    <UButton type="button" color="neutral" variant="ghost" class="inline-flex items-center disabled:opacity-60" :disabled="isPending || !hydrated">
      <Loader2 v-if="isPending" class="size-4 animate-spin text-muted" />
      <StateBadge v-else :state="task.state" />
    </UButton>
  </UDropdownMenu>
</template>
