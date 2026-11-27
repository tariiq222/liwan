<script setup lang="ts">
import { useWindowScroll } from '@vueuse/core'

// The flat sticky top bar: `start` carries the product mark on phones (the sidebar is absent there), `search` the
// command-palette trigger, `end` the tools. A hairline appears under it once the page has scrolled.
const props = defineProps<{ label: string; /** Keep the start slot on every width (a console without a sidebar column to carry the mark). */ showStart?: boolean }>()
defineSlots<{ start?: () => unknown; search?: () => unknown; end?: () => unknown }>()
const { y } = useWindowScroll()
const scrolled = computed(() => y.value > 6)
</script>

<template>
  <header data-testid="shell-header" class="liwan-shell-header liwan-print-hide" :data-scrolled="scrolled ? 'true' : undefined" :data-start="props.showStart ? 'always' : undefined" :aria-label="props.label">
    <div v-if="$slots.start" class="liwan-shell-header-start"><slot name="start" /></div>
    <div v-if="$slots.search" class="liwan-shell-header-search"><slot name="search" /></div>
    <div class="liwan-shell-header-end"><slot name="end" /></div>
  </header>
</template>
