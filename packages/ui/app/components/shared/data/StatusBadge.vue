<script setup lang="ts">
import { statusPillAttrs } from '../../../utils/statusPill'
import { STATUS_COLOR, type StatusTone } from '../../../utils/statusTone'

// The one status badge (Tasmim spec §6): a fixed semantic tone and a translated label, drawn as the shared status pill
// (utils/statusPill.ts: 24px, 7px radius, 1px border, soft fill). An optional leading icon names the state beyond colour.
// Applications keep their own maps (projectStatusBadge, taskStateBadge, …) and translate at the call site.
const DOT_CLASS: Record<StatusTone, string> = {
  success: 'bg-success',
  info: 'bg-info',
  warning: 'bg-warning',
  destructive: 'bg-error',
  neutral: 'bg-(--ui-text-muted)',
  primary: 'bg-primary',
}
const props = withDefaults(defineProps<{ tone: StatusTone; label: string; variant?: 'subtle' | 'outline'; icon?: string; size?: 'sm' | 'md' }>(), { variant: 'subtle', size: 'md' })
</script>

<template>
  <UBadge :color="STATUS_COLOR[props.tone]" :variant="props.variant" :icon="props.icon" :size="props.size" v-bind="statusPillAttrs(props.tone)">
    <span v-if="!props.icon" class="size-1.5 shrink-0 rounded-full" :class="DOT_CLASS[props.tone]" aria-hidden="true" />
    <span>{{ props.label }}</span>
  </UBadge>
</template>
