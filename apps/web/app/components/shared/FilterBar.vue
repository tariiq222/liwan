<template>
  <FilterCard
    :title="props.title"
    :active-count="props.activeCount"
    :clear-label="props.clearLabel"
    :disabled="props.disabled"
    :default-open="props.defaultOpen"
    @clear="$emit('clear')"
  >
    <template v-if="$slots.view || $slots.actions" #actions>
      <div v-if="$slots.view" data-slot="view" class="flex flex-wrap items-center gap-2">
        <slot name="view" />
      </div>
      <div v-if="$slots.actions" data-slot="filter-actions" class="flex shrink-0 flex-wrap items-center gap-2">
        <slot name="actions" />
      </div>
    </template>
    <div data-slot="filter-row" class="grid min-w-0 gap-3">
      <div v-if="$slots.search" data-slot="search" class="min-w-0">
        <slot name="search" />
      </div>
      <div v-if="$slots.default" data-slot="controls" class="flex min-w-0 flex-wrap items-center gap-2">
        <slot />
      </div>
    </div>
    <template v-if="$slots.active" #active>
      <slot name="active" />
    </template>
  </FilterCard>
</template>

<script setup lang="ts">
import FilterCard from '@/components/shared/FilterCard.vue'

const props = withDefaults(defineProps<{
  title?: string
  activeCount?: number
  clearLabel?: string
  disabled?: boolean
  defaultOpen?: boolean
}>(), {
  activeCount: 0,
  disabled: false,
  defaultOpen: false,
})

defineEmits<{
  clear: []
}>()
</script>
