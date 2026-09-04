<script setup lang="ts">
import type { Task, TaskState } from '@nasq/contracts'
import { Loader2 } from 'lucide-vue-next'
import { toast } from 'vue-sonner'
import { STATE_LABEL_KEY, nextStates } from '@/composables/taskState'
import { ApiError } from '@/composables/useApi'
import { useTransitionTask } from '@/composables/useTasks'
import StateBadge from './StateBadge.vue'

// Ruling: the list view has no can_approve on Task (only TaskDetail has it),
// so `canApprove` defaults to true here and the server is the real gate —
// a 403 `transition_forbidden` surfaces as a toast instead of hiding items.
const props = withDefaults(defineProps<{ task: Task; canApprove?: boolean }>(), { canApprove: true })

const { t } = useI18n()
const { mutate, isPending } = useTransitionTask()

const states = computed(() => nextStates(props.task.state, props.canApprove))

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
  <DropdownMenu>
    <DropdownMenuTrigger as-child :disabled="isPending">
      <button type="button" class="inline-flex items-center disabled:opacity-60" :disabled="isPending">
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
