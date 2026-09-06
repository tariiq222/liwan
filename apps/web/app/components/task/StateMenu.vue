<script setup lang="ts">
import type { Task, TaskState } from '@nasq/contracts'
import { Loader2 } from '@lucide/vue'
import { toast } from 'vue-sonner'
import { STATE_LABEL_KEY } from '@/composables/taskState'
import { ApiError } from '@/composables/useApi'
import { useTransitionTask } from '@/composables/useTasks'
import StateBadge from './StateBadge.vue'

const props = defineProps<{ task: Task; canApprove?: boolean }>()

const { t } = useI18n()
const { mutate, isPending } = useTransitionTask()
const hydrated = useHydrated()

const states = computed(() => props.task.allowed_transitions ?? [])

function onSelect(state: TaskState) {
  mutate(
    { id: props.task.id, state },
    {
      onError: (err) => {
        if (err instanceof ApiError && err.code === 'transition_forbidden') toast.error(t('tasks.transition.forbidden'))
        else if (err instanceof ApiError) toast.error(err.message)
        else toast.error(t('errors.generic'))
      },
    },
  )
}
</script>

<template>
  <StateBadge v-if="!states.length" :state="task.state" />
  <DropdownMenu v-else>
    <DropdownMenuTrigger as-child :disabled="isPending || !hydrated">
      <button type="button" class="inline-flex items-center disabled:opacity-60" :disabled="isPending || !hydrated">
        <Loader2 v-if="isPending" class="size-4 animate-spin text-muted-foreground" />
        <StateBadge v-else :state="task.state" />
      </button>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="start">
      <DropdownMenuItem v-for="s in states" :key="s" @select="onSelect(s)">
        {{ t(STATE_LABEL_KEY[s]) }}
      </DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenu>
</template>
