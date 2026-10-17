<script setup lang="ts">
import { taskStateBadge } from '@/composables/taskState'
import { statusPillAttrs } from '@webvue/ui/app/utils/statusPill'
import { badgeLabel } from '@webvue/ui/app/utils/statusBadge'
import type { Task, TaskState } from '@webvue/contracts'
import { STATE_LABEL_KEY } from '@/composables/taskState'
import { ApiError } from '@/composables/useApi'
import { useTransitionTask } from '@/composables/useTasks'

const props = defineProps<{ task: Task; canApprove?: boolean }>()

const { t } = useI18n()
const stateBadge = (state: TaskState) => { const entry = taskStateBadge(state); return { tone: entry.tone, label: badgeLabel(entry, state, t) } }
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
  <SharedStatusBadge v-if="!states.length" class="min-w-25 justify-center" v-bind="stateBadge(task.state)" />
  <UDropdownMenu v-else :items="items" :content="{ align: 'start' }">
    <button type="button" v-bind="statusPillAttrs(stateBadge(task.state).tone, true)" class="min-w-25 justify-center disabled:opacity-60" :disabled="isPending || !hydrated">
      <UIcon v-if="isPending" name="i-lucide-loader-2" class="size-3.5 animate-spin" aria-hidden="true" />
      <template v-else>{{ stateBadge(task.state).label }}</template>
    </button>
  </UDropdownMenu>
</template>
