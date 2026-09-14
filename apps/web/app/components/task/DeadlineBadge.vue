<script setup lang="ts">
import { deadlineLabel } from '@/composables/taskState'
import { deadlineTone } from '@/utils/statusTone'

const props = defineProps<{
  deadline: string | null
  daysRemaining: number | null
  isClosed: boolean
}>()
const { t } = useI18n()

const tone = computed(() => deadlineTone(props.daysRemaining, props.isClosed))
const label = computed(() => deadlineLabel(props.daysRemaining, t))
</script>

<template>
  <span class="nasq-ui-status-pill" :data-tone="tone" data-testid="deadline-badge">{{ label }}</span>
</template>
