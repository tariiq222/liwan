<script setup lang="ts">
// A horizontal rail that snaps card by card. It is a focusable labelled region, so the keyboard scrolls it.
defineProps<{ label: string }>()
</script>

<template>
  <!-- The padding and the matching negative margin leave room for a card's lift and shadow without clipping them. -->
  <div
    role="region"
    tabindex="0"
    :aria-label="label"
    class="-mx-1.5 -mb-5 -mt-4 flex scroll-px-1.5 snap-x snap-mandatory gap-4 overflow-x-auto px-1.5 pb-10 pt-4 [scrollbar-width:none] *:shrink-0 *:snap-start focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary [&::-webkit-scrollbar]:hidden"
  >
    <slot />
  </div>
</template>
