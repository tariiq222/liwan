<template>
  <div class="grid min-w-48 max-w-full gap-1.5" :class="inRow && 'md:flex md:min-w-0 md:items-center md:gap-2'" data-slot="filter-field" :role="group ? 'group' : undefined" :aria-label="group ? label : undefined">
    <component :is="group ? 'span' : 'label'" class="text-xs font-medium text-muted" :class="inRow && 'md:shrink-0 md:whitespace-nowrap'" :for="group ? undefined : props.for">{{ label }}</component>
    <slot />
  </div>
</template>

<script setup lang="ts">
import { FILTER_ROW_KEY } from '../../../utils/filterBar'
// Stacked label over control in the filter panel; beside it when the bar lays its fields in the toolbar row.
const props = defineProps<{
  label: string
  /** Id of the single control this label names; omit when the field wraps a button group. */
  for?: string
}>()
const group = computed(() => !props.for)
const inRow = inject(FILTER_ROW_KEY, computed(() => false))
</script>
