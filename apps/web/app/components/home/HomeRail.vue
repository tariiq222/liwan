<script setup lang="ts">
// A horizontal rail that snaps card by card. It is a focusable labelled region, so the keyboard scrolls it; the owner's
// arrow buttons call `scrollCards`, which follows the reading direction (toward the end is left in Arabic).
defineProps<{ label: string }>()
/** One 300px card and its gap, with a little extra so the next card's edge shows. */
const CARD_STEP = 320
const rail = ref<HTMLElement | null>(null)

function scrollCards(direction: 1 | -1) {
  const element = rail.value
  if (!element) return
  const sign = getComputedStyle(element).direction === 'rtl' ? -1 : 1
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  element.scrollBy({ left: sign * direction * CARD_STEP, behavior: reduced ? 'auto' : 'smooth' })
}
defineExpose({ scrollCards })
</script>

<template>
  <!-- The padding and the matching negative margin leave room for a card's lift and shadow without clipping them. -->
  <div
    ref="rail"
    role="region"
    tabindex="0"
    :aria-label="label"
    class="-mx-1.5 -mb-5 -mt-4 flex scroll-px-1.5 snap-x snap-mandatory gap-4 overflow-x-auto px-1.5 pb-10 pt-4 [scrollbar-width:none] *:shrink-0 *:snap-start focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary [&::-webkit-scrollbar]:hidden"
  >
    <slot />
  </div>
</template>
