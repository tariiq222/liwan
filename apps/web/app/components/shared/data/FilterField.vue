<template>
  <div class="grid min-w-48 max-w-full gap-1.5" data-slot="filter-field" :role="group ? 'group' : undefined" :aria-label="group ? label : undefined">
    <component :is="group ? 'span' : 'label'" class="text-xs font-medium text-muted" :for="group ? undefined : props.for">{{ label }}</component>
    <slot />
  </div>
</template>

<script setup lang="ts">
const props = defineProps<{
  label: string
  /** Id of the single control this label names; omit when the field wraps a button group. */
  for?: string
}>()
const group = computed(() => !props.for)
</script>
