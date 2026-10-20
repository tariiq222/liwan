<template>
  <div v-if="props.inline" class="min-w-0 space-y-2" data-slot="inline-filter-bar">
    <div class="flex min-w-0 flex-wrap items-center gap-2">
      <div v-if="$slots.search" data-shortcut-search class="min-w-48 flex-1 *:w-full"><slot name="search" /></div>
      <slot />
      <slot name="view" />
      <slot name="actions" />
      <UButton v-if="activeCount > 0" type="button" color="neutral" variant="ghost" icon="i-lucide-rotate-ccw" :label="resolvedClearLabel" :aria-label="resolvedClearLabel" :disabled="isDisabled" @click="$emit('clear')"></UButton>
    </div>
    <div v-if="activeCount > 0 && $slots.active" class="flex flex-wrap items-center gap-2"><slot name="active" /></div>
  </div>
  <div v-else-if="props.embedded" data-slot="filter-root" data-variant="embedded" class="min-w-0 space-y-2">
    <div class="flex flex-wrap items-center gap-2">
      <div v-if="$slots.search" data-slot="search" data-shortcut-search class="min-w-48 flex-1 *:w-full">
        <slot name="search" />
      </div>
      <UButton v-if="$slots.default" ref="trigger" type="button" color="neutral" :variant="expanded ? 'soft' : 'outline'" square class="md:hidden" icon="i-lucide-list-filter" :aria-label="resolvedTitle" :title="resolvedTitle" :aria-expanded="expanded" :aria-controls="contentId" :disabled="isDisabled" @click="expanded = !expanded" />
      <UBadge v-if="activeCount > 0" color="primary" class="md:hidden">{{ activeCount }}</UBadge>
      <!-- From md up the fields are always in the row (the class beats v-show's display:none); on phones they open under the bar. -->
      <div v-if="$slots.default" v-show="expanded" :id="contentId" class="w-full rounded-card bg-default p-4 ring ring-default md:contents! md:p-0" data-slot="filter-fields" :aria-label="resolvedTitle" role="region" :aria-busy="isDisabled" @keydown.esc.stop="close">
        <div data-slot="controls" class="flex min-w-0 flex-wrap items-start gap-x-6 gap-y-3 md:contents"><slot /></div>
      </div>
      <UButton v-if="activeCount > 0" type="button" color="neutral" variant="ghost" icon="i-lucide-rotate-ccw" :label="resolvedClearLabel" :aria-label="resolvedClearLabel" :title="resolvedClearLabel" :disabled="isDisabled" @click="$emit('clear')" />
      <div v-if="$slots.view || listView?.view.value" data-slot="view" class="ms-auto flex flex-wrap items-center gap-2">
        <slot name="view" />
        <ViewSwitch v-if="listView?.view.value" :model-value="listView.view.value" :options="[...listView.options]" @update:model-value="listView.setView" />
      </div>
      <div v-if="$slots.actions" data-slot="filter-actions" class="flex shrink-0 flex-wrap items-center gap-2"><slot name="actions" /></div>
    </div>
    <div v-if="activeCount > 0 && $slots.active" data-slot="active-row" class="flex flex-wrap items-center gap-2 text-xs text-muted"><slot name="active" /></div>
  </div>
  <div v-else data-slot="filter-root" class="min-w-0 space-y-2">
    <div class="flex flex-wrap items-center gap-2">
      <div v-if="$slots.search" data-slot="search" data-shortcut-search class="min-w-48 flex-1 *:w-full">
        <slot name="search" />
      </div>
      <UButton v-if="$slots.default" ref="trigger" type="button" color="neutral" :variant="expanded ? 'soft' : 'outline'" square icon="i-lucide-list-filter" :aria-label="resolvedTitle" :title="resolvedTitle" :aria-expanded="expanded" :aria-controls="contentId" :disabled="isDisabled" @click="expanded = !expanded" />
      <UBadge v-if="activeCount > 0" color="primary">{{ activeCount }}</UBadge>
      <UButton v-if="activeCount > 0" type="button" color="neutral" variant="ghost" icon="i-lucide-rotate-ccw" :label="resolvedClearLabel" :aria-label="resolvedClearLabel" :title="resolvedClearLabel" :disabled="isDisabled" @click="$emit('clear')" />
      <div v-if="$slots.view" data-slot="view" class="ms-auto flex flex-wrap items-center gap-2"><slot name="view" /></div>
      <div v-if="$slots.actions" data-slot="filter-actions" class="flex shrink-0 flex-wrap items-center gap-2"><slot name="actions" /></div>
    </div>
    <div v-if="$slots.default" v-show="expanded" :id="contentId" class="rounded-card ring ring-default bg-default p-4" data-slot="filter-fields" :aria-label="resolvedTitle" role="region" :aria-busy="isDisabled" @keydown.esc.stop="close">
      <div data-slot="controls" class="flex min-w-0 flex-wrap items-start gap-x-6 gap-y-3"><slot /></div>
    </div>
    <div v-if="activeCount > 0 && $slots.active" data-slot="active-row" class="flex flex-wrap items-center gap-2 text-xs text-muted"><slot name="active" /></div>
  </div>
</template>

<script setup lang="ts">
import { FILTER_ROW_KEY } from '../../../utils/filterBar'
import { LIST_VIEW_KEY } from '../../../utils/listView'
import ViewSwitch from './ViewSwitch.vue'
// The one list toolbar (DESIGN.md §6): a visible search, then a trigger that shows the
// filter fields under the bar (Esc closes them and returns focus), a count and a clear
// action. `inline` lays every control in one row for embedded toolbars. `embedded` is the toolbar of a card
// header (DataTable `embedded-filters`): the search, the fields (compact dropdowns), the clear action and the view
// in one calm row from md up; on phones the fields keep the collapsible panel. Inside a SharedListPage with
// `viewsInFilters` it also draws the page's view switch at the end of the row.
const props = withDefaults(defineProps<{
  inline?: boolean
  embedded?: boolean
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
defineEmits<{ clear: [] }>()
const listView = inject(LIST_VIEW_KEY, null)
provide(FILTER_ROW_KEY, computed(() => props.inline || props.embedded))
const { t } = useI18n()
const hydrated = useHydrated()
const expanded = ref(props.defaultOpen)
const trigger = ref<{ $el?: HTMLElement } | null>(null)
function close() {
  expanded.value = false
  trigger.value?.$el?.focus()
}
const contentId = `filter-card-${useId()}`
const activeCount = computed(() => Math.max(0, props.activeCount ?? 0))
const isDisabled = computed(() => props.disabled || !hydrated.value)
const resolvedTitle = computed(() => props.title || t('filterCard.title'))
const resolvedClearLabel = computed(() => props.clearLabel || t('filterCard.clear'))
</script>
