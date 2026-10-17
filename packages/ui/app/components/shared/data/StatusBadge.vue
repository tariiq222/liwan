<script setup lang="ts">
import { statusPillAttrs } from '../../../utils/statusPill'
import { STATUS_COLOR, type StatusTone } from '../../../utils/statusTone'

// The one status badge (Tasmim spec §6): a fixed semantic tone and a translated label, drawn as the shared status pill
// (utils/statusPill.ts: 24px, full radius, 1px border, soft fill). An optional leading icon names the state beyond colour.
// Applications keep their own maps (projectStatusBadge, taskStateBadge, …) and translate at the call site.
const props = withDefaults(defineProps<{ tone: StatusTone; label: string; variant?: 'subtle' | 'outline'; icon?: string; size?: 'sm' | 'md' }>(), { variant: 'subtle', size: 'md' })
</script>

<template>
  <UBadge :color="STATUS_COLOR[props.tone]" :variant="props.variant" :icon="props.icon" :size="props.size" v-bind="statusPillAttrs(props.tone)">{{ props.label }}</UBadge>
</template>
