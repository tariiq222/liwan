<template>
  <div v-if="props.inline" class="min-w-0 space-y-2" data-slot="inline-filter-bar">
    <div class="flex min-w-0 flex-wrap items-center gap-2">
      <div v-if="$slots.search" class="min-w-48 flex-1"><slot name="search" /></div>
      <slot />
      <slot name="view" />
      <slot name="actions" />
      <Button v-if="props.activeCount > 0" type="button" variant="ghost" size="sm" :disabled="props.disabled || !hydrated" @click="$emit('clear')">{{ props.clearLabel || t('filterCard.clear') }}</Button>
    </div>
    <div v-if="props.activeCount > 0 && $slots.active" class="flex flex-wrap items-center gap-2"><slot name="active" /></div>
  </div>
  <FilterCard
    v-else
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

const { t } = useI18n()
const hydrated = useHydrated()

const props = withDefaults(defineProps<{
  inline?: boolean
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
