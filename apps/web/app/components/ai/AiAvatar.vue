<script setup lang="ts">
// The assistant's mark: a solid primary circle with a white sparkles icon (icon only, never text on the accent).
const props = withDefaults(defineProps<{ size?: 'sm' | 'md' | 'lg' }>(), { size: 'sm' })
const SIZES = { sm: ['size-7', 'size-4'], md: ['size-8', 'size-5'], lg: ['size-14', 'size-7'] } as const
</script>

<template>
  <span aria-hidden="true" data-slot="ai-avatar" :class="['inline-grid shrink-0 place-items-center rounded-full bg-primary text-inverted', SIZES[props.size][0]]">
    <UIcon name="i-lucide-sparkles" :class="SIZES[props.size][1]" />
  </span>
</template>
