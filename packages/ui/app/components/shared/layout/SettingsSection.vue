<script setup lang="ts">
/*
 * A titled group of related settings on a settings page (DESIGN.md §6): a heading with a one-line description, then the
 * page's cards or rows. It lists itself in the page's in-page section navigation (SharedSettingsPage shows that
 * navigation on the end side of a long page), and its anchor `id` scrolls clear of the sticky top bar.
 */
import { useSettingsNav } from '../../../composables/useSettingsNav'

const props = defineProps<{ id: string; title: string; description?: string }>()
const nav = useSettingsNav()
onMounted(() => nav?.add({ id: props.id, title: props.title }))
onBeforeUnmount(() => nav?.remove(props.id))
</script>

<template>
  <section :id="props.id" class="liwan-settings-anchor grid gap-3" :aria-labelledby="`${props.id}-heading`" data-slot="settings-section">
    <header>
      <h2 :id="`${props.id}-heading`" class="liwan-sadu-diamond-mark font-display text-xl font-bold text-highlighted">{{ props.title }}</h2>
      <p v-if="props.description" class="mt-1 text-sm text-muted">{{ props.description }}</p>
    </header>
    <div class="grid gap-(--liwan-gap-card)"><slot /></div>
  </section>
</template>
