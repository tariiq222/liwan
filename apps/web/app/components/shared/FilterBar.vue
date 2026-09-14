<template>
  <div v-if="props.inline" class="min-w-0" data-slot="inline-filter-bar">
    <div class="flex min-w-0 flex-wrap items-center gap-2">
      <div v-if="$slots.search" data-slot="search" class="w-full min-w-0 sm:w-72 sm:flex-none"><slot name="search" /></div>
      <slot />
      <div v-if="props.activeCount > 0 && $slots.active" data-slot="active-row" class="flex min-w-0 flex-wrap items-center gap-1.5"><slot name="active" /></div>
      <UButton v-if="props.activeCount > 0" type="button" color="error" variant="ghost" square icon="i-lucide-trash-2" :aria-label="props.clearLabel || t('filterCard.clear')" :disabled="props.disabled || !hydrated" @click="$emit('clear')"></UButton>
      <div v-if="$slots.view || $slots.actions" class="ms-auto flex min-w-0 flex-wrap items-center gap-2">
        <slot name="view" />
        <slot name="actions" />
      </div>
    </div>
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
    <template v-if="$slots.search" #search>
      <slot name="search" />
    </template>
    <template v-if="$slots.view || $slots.actions" #actions>
      <div v-if="$slots.view" data-slot="view" class="ms-auto flex flex-wrap items-center gap-2">
        <slot name="view" />
      </div>
      <div v-if="$slots.actions" data-slot="filter-actions" class="flex shrink-0 flex-wrap items-center gap-2">
        <slot name="actions" />
      </div>
    </template>
    <template v-if="$slots.default" #default>
      <div data-slot="controls" class="flex min-w-0 flex-wrap items-start gap-x-6 gap-y-3">
        <slot />
      </div>
    </template>
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
