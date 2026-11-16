<script setup lang="ts">
// `bordered` draws the empty state as a card (the dashed 1.5px placeholder on the surface fill, 24px radius) for a page
// whose whole body is empty; the default is the dashed placeholder inside a block that already has a card. A full-size empty
// state shows `icon` (an Iconify name for the content, default an inbox) in a quiet 44px tile above the title; the `icon`
// slot overrides the glyph inside the same tile. `compact` shows no icon.
const props = withDefaults(defineProps<{
  title: string
  icon?: string
  description?: string
  bordered?: boolean
  compact?: boolean
}>(), { icon: 'i-lucide-inbox' })
</script>

<template>
  <div
    role="status"
    aria-live="polite"
    :data-bordered="props.bordered || undefined"
    class="flex flex-col items-center justify-center gap-3 text-center"
    :class="[props.compact ? 'rounded-card px-4 py-4' : 'rounded-surface px-5 py-14', ['border-[1.5px] border-dashed border-default', props.bordered && 'bg-default']]"
  >
    <div v-if="!props.compact" data-slot="empty-icon" class="grid size-11 place-items-center rounded-tile bg-muted text-muted" aria-hidden="true">
      <slot name="icon"><UIcon :name="props.icon" class="size-5" /></slot>
    </div>
    <p class="text-highlighted" :class="props.compact ? 'font-medium' : 'font-display text-xl font-bold'">{{ props.title }}</p>
    <p v-if="props.description" class="max-w-[420px] text-sm text-muted">{{ props.description }}</p>
    <div v-if="$slots.action" class="flex items-center gap-2">
      <slot name="action" />
    </div>
  </div>
</template>
