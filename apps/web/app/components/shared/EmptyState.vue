<script setup lang="ts">
const props = defineProps<{
  title: string
  description?: string
}>()
</script>

<template>
  <div role="status" aria-live="polite" class="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-default px-6 py-10 text-center">
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
