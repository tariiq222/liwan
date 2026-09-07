<script setup lang="ts">
import { deadlineLabel } from '@/composables/taskState'
import { STATUS_CHIP_CLASS } from '@/utils/statusTone'

type DeadlineTone = 'neutral' | 'warning' | 'destructive'

const props = defineProps<{
  deadline: string | null
  daysRemaining: number | null
  isClosed: boolean
}>()
const { t } = useI18n()

const TONE_CLASS: Record<DeadlineTone, string> = {
  neutral: STATUS_CHIP_CLASS.neutral,
  warning: STATUS_CHIP_CLASS.warning,
  destructive: STATUS_CHIP_CLASS.destructive,
}

// A closed task is never "urgent" regardless of how the deadline compares to
// today, so it always falls back to the neutral/muted tone.
const tone = computed<DeadlineTone>(() => {
  if (props.isClosed || props.daysRemaining === null) return 'neutral'
  if (props.daysRemaining < 0) return 'destructive'
  if (props.daysRemaining <= 2) return 'warning'
  return 'neutral'
})

const label = computed(() => deadlineLabel(props.daysRemaining, t))
</script>

<template>
  <Badge variant="outline" data-testid="deadline-badge" :class="TONE_CLASS[tone]">{{ label }}</Badge>
</template>
