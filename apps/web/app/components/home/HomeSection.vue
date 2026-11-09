<script setup lang="ts">
// A titled section of a foundation page: the display heading with its small Sadu mark (a diamond, or the triangle for the
// first thing to do), an optional one-line subtitle, and room at the end of the heading row for arrows or chips.
defineProps<{ title: string; subtitle?: string; mark: 'diamond' | 'triangle' }>()
const titleId = useId()
</script>

<template>
  <section :aria-labelledby="titleId" class="pt-5">
    <div class="mb-4 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h2 :id="titleId" class="font-display text-xl font-bold tracking-tight text-highlighted">
          <span :class="mark === 'triangle' ? 'liwan-sadu-triangle-mark' : 'liwan-sadu-diamond-mark'" aria-hidden="true" />{{ title }}
        </h2>
        <p v-if="subtitle" class="text-sm text-muted">{{ subtitle }}</p>
      </div>
      <slot name="actions" />
    </div>
    <slot />
  </section>
</template>
