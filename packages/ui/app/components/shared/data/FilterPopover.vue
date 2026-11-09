<script setup lang="ts">
// The one «فلاتر» button of a list toolbar (the project task toolbar's pattern): a soft button with the count of active filters
// that opens a popover holding the page's filter fields, stacked label over control (SharedFilterField / SharedFilterChoice).
// It goes in the default slot of `<SharedFilterBar inline>`; the bar draws the search, the clear action and the removable chips.
const props = withDefaults(defineProps<{
  /** Number of active filters, shown as a badge on the button. */
  count?: number
  disabled?: boolean
}>(), { count: 0, disabled: false })
const { t } = useI18n()
const hydrated = useHydrated()
const filterCount = computed(() => Math.max(0, props.count))
</script>

<template>
  <UPopover modal :content="{ align: 'start' }" :ui="{ content: 'w-[min(92vw,26rem)] p-4' }">
    <UButton
      type="button"
      color="neutral"
      variant="soft"
      icon="i-lucide-list-filter"
      data-slot="filter-popover-button"
      :label="t('filterCard.button')"
      :disabled="props.disabled || !hydrated"
    >
      <template v-if="filterCount > 0" #trailing>
        <UBadge color="primary" size="sm" data-slot="filter-popover-count" aria-hidden="true">{{ filterCount }}</UBadge>
      </template>
    </UButton>
    <template #content>
      <div class="space-y-4" role="group" data-slot="filter-popover-content" :aria-label="t('filterCard.popoverTitle')">
        <h2 class="text-sm font-semibold text-highlighted">{{ t('filterCard.popoverTitle') }}</h2>
        <slot />
      </div>
    </template>
  </UPopover>
</template>
