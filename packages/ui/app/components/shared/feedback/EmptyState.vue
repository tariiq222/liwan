<script setup lang="ts">
// `bordered` draws the empty state as a card (the shared card recipe: 18px radius, hairline ring, white fill) for a page
// whose whole body is empty; the default is the dashed placeholder inside a block that already has a card.
const props = defineProps<{
  title: string
  description?: string
  bordered?: boolean
}>()
</script>

<template>
  <div
    role="status"
    aria-live="polite"
    :data-bordered="props.bordered || undefined"
    class="flex flex-col items-center justify-center gap-3 rounded-card px-6 py-10 text-center"
    :class="props.bordered ? 'bg-default ring ring-default' : 'border border-dashed border-default'"
  >
    <div v-if="$slots.icon" class="text-muted" aria-hidden="true">
      <slot name="icon" />
    </div>
    <p class="font-medium text-highlighted">{{ props.title }}</p>
    <p v-if="props.description" class="max-w-prose text-sm text-muted">{{ props.description }}</p>
    <div v-if="$slots.action" class="flex items-center gap-2">
      <slot name="action" />
    </div>
  </div>
</template>
