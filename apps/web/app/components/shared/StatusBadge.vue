<script setup lang="ts">
import { STATUS_COLOR, type StatusTone } from '@/utils/statusTone'

// The one status badge (Tasmim spec §6): a fixed semantic tone and a translated label.
// Applications keep their own maps (projectStatusBadge, taskStateBadge, …) and translate at the call site.
const props = withDefaults(defineProps<{ tone: StatusTone; label: string; variant?: 'subtle' | 'outline'; icon?: string; size?: 'sm' | 'md' }>(), { variant: 'subtle', size: 'md' })
</script>

<template>
  <UBadge :color="STATUS_COLOR[props.tone]" :variant="props.variant" :icon="props.icon" :size="props.size" :data-tone="props.tone">{{ props.label }}</UBadge>
</template>
