<script setup lang="ts">
// `bordered` draws the empty state as a card (the dashed 1.5px placeholder on the surface fill, 24px radius) for a page
// whose whole body is empty; the default is the dashed placeholder inside a block that already has a card. Without an
// `icon` slot a full-size empty state shows the Sadu tree in sand (decorative); `compact` shows no art.
const props = defineProps<{
  title: string
  description?: string
  bordered?: boolean
  compact?: boolean
}>()
</script>

<template>
  <div
    role="status"
    aria-live="polite"
    :data-bordered="props.bordered || undefined"
    class="flex flex-col items-center justify-center gap-3 text-center"
    :class="[props.compact ? 'rounded-card px-4 py-4' : 'rounded-surface px-5 py-14', ['border-[1.5px] border-dashed border-default', props.bordered && 'bg-default']]"
  >
    <div v-if="$slots.icon" class="text-muted" aria-hidden="true">
      <slot name="icon" />
    </div>
    <span v-else-if="!props.compact" data-slot="empty-art" class="liwan-sadu-tree" aria-hidden="true" />
    <p class="text-highlighted" :class="props.compact ? 'font-medium' : 'font-display text-xl font-bold'">{{ props.title }}</p>
    <p v-if="props.description" class="max-w-[420px] text-sm text-muted">{{ props.description }}</p>
    <div v-if="$slots.action" class="flex items-center gap-2">
      <slot name="action" />
    </div>
  </div>
</template>
