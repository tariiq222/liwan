<script setup lang="ts">
import type { TaskState } from '@nasq/contracts'
import type { StateTone } from '@/composables/taskState'
import { STATE_LABEL_KEY, STATE_TONE } from '@/composables/taskState'

// Presentational only: state -> label + color. `tone` is optional so a caller
// (e.g. a future kanban card) can override the default STATE_TONE mapping;
// most callers just pass `state`.
const props = defineProps<{ state: TaskState; tone?: StateTone }>()
const { t } = useI18n()

const TONE_CLASS: Record<StateTone, string> = {
  neutral: 'border-transparent bg-muted text-muted-foreground',
  info: 'border-transparent bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300',
  warning: 'border-transparent bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300',
  success: 'border-transparent bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300',
  destructive: 'border-transparent bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300',
}

const tone = computed(() => props.tone ?? STATE_TONE[props.state])
</script>

<template>
  <Badge variant="outline" :class="TONE_CLASS[tone]">{{ t(STATE_LABEL_KEY[state]) }}</Badge>
</template>
