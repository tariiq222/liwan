<script setup lang="ts">
// The one «فلاتر» button of a list toolbar (the project task toolbar's pattern): a soft button with the count of active filters
// that opens a popover holding the page's filter fields, stacked label over control (SharedFilterField / SharedFilterChoice).
// It goes in the default slot of `<SharedFilterBar inline>`; the bar draws the search, the clear action and the removable chips.
import { FILTER_ROW_KEY } from '../../../utils/filterBar'
const props = withDefaults(defineProps<{
  /** Number of active filters, shown as a badge on the button. */
  count?: number
  disabled?: boolean
}>(), { count: 0, disabled: false })
const { t } = useI18n()
const hydrated = useHydrated()
const filterCount = computed(() => Math.max(0, props.count))
// The popover stacks its fields (label over control). SharedFilterBar provides FILTER_ROW_KEY=true for the inline
// row, and fields rendered in this popover's content still read that injection, which squeezed them side by side
// inside a 26rem popover (the HR lists). Overriding it false here gives every field in the popover the stacked form.
// Nothing is injected inside a popover's teleported content from the popover's own setup scope unless provided here.
provide(FILTER_ROW_KEY, computed(() => false))
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
      <!-- The popover stacks its fields label over control. SharedFilterBar provides FILTER_ROW_KEY=true for the
           inline row, and its fields read that injection inside this content too, which squeezed them side by side in
           a 26rem popover (the HR lists). Providing false here makes every field in the popover take the stacked form. -->
      <div class="space-y-4" role="group" data-slot="filter-popover-content" :aria-label="t('filterCard.popoverTitle')">
        <h2 class="text-sm font-semibold text-highlighted">{{ t('filterCard.popoverTitle') }}</h2>
        <div class="max-h-[min(60vh,32rem)] overflow-y-auto pe-1">
          <slot />
        </div>
      </div>
    </template>
  </UPopover>
</template>
