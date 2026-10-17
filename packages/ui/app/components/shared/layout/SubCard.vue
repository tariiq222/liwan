<script setup lang="ts">
// An inner block inside a card or a form (a charter row, a follower, a stage): 12px radius (`rounded-control`),
// a hairline ring and 12px padding. `tinted` is the secondary kind: a soft elevated fill and no ring. It is a plain
// box with no heading of its own; a titled block is SharedRecordSection.
const props = withDefaults(defineProps<{
  tone?: 'default' | 'tinted'
  /** The element to render, e.g. `li` inside a list. */
  as?: string
}>(), { tone: 'default', as: 'div' })
</script>

<template>
  <component
    :is="props.as"
    data-slot="sub-card"
    :data-tone="props.tone"
    class="min-w-0 rounded-control p-(--webvue-subcard-pad)"
    :class="props.tone === 'tinted' ? 'bg-elevated/50' : 'ring ring-default'"
  >
    <slot />
  </component>
</template>
