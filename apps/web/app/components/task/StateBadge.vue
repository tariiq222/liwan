<script setup lang="ts">
import type { TaskState } from '@nasq/contracts'
import type { StateTone } from '@/composables/taskState'
import { STATE_LABEL_KEY } from '@/composables/taskState'
import { stateToneToPill } from '@/utils/statusTone'

// Presentational only: state -> label + pill tone. `tone` is optional so a
// caller can override the state's own colour; most callers just pass `state`.
const props = defineProps<{ state: TaskState; tone?: StateTone }>()
const { t } = useI18n()

const tone = computed(() => props.tone ? stateToneToPill(props.tone) : props.state)
</script>

<template>
  <span class="nasq-ui-status-pill" :data-tone="tone">{{ t(STATE_LABEL_KEY[state]) }}</span>
</template>
