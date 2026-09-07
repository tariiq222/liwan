<script setup lang="ts">
import type { TaskState } from '@nasq/contracts'
import type { StateTone } from '@/composables/taskState'
import { STATE_LABEL_KEY, STATE_TONE } from '@/composables/taskState'
import { STATUS_CHIP_CLASS } from '@/utils/statusTone'

// Presentational only: state -> label + color. `tone` is optional so a caller
// (e.g. a future kanban card) can override the default STATE_TONE mapping;
// most callers just pass `state`.
const props = defineProps<{ state: TaskState; tone?: StateTone }>()
const { t } = useI18n()

const tone = computed(() => props.tone ?? STATE_TONE[props.state])
</script>

<template>
  <Badge variant="outline" :class="STATUS_CHIP_CLASS[tone]">{{ t(STATE_LABEL_KEY[state]) }}</Badge>
</template>
