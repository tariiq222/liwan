<script setup lang="ts">
/*
 * The one segmented group (DESIGN.md §6): a 12px container (faint fill, 4px padding) with one 8px segment per
 * option; the chosen one is a raised surface thumb (ring + soft shadow, bold ink label) over the faint container,
 * the rest are `ghost` and muted. In the default `toggle` mode it is a labelled group of toggle
 * buttons (`aria-pressed`), bound with v-model. Used for scopes (open/closed, active/archived), kinds, groupings,
 * scales and, icon-only, the list view switch. Waits for hydration like every interactive control.
 *
 * `mode="actions"` is the same pill group for ACTIONS (edit, add child, open a list): plain buttons, or links when an
 * item has `to`; no v-model, no selected state and no `aria-pressed`. Each button item emits `select` with its value.
 *
 * `icon-only` draws square icon buttons with a tooltip (the label stays the accessible name); `block` makes the group
 * fill its row with equal segments. Attributes (`data-testid`) land on the group.
 */
export interface SegmentedItem { value: string; label: string; icon?: string; testId?: string; disabled?: boolean; /** Actions mode: renders a link. */ to?: string }

const props = defineProps<{
  /** Toggle mode only: the chosen item. */
  modelValue?: string
  items: SegmentedItem[]
  /** The accessible name of the group. */
  label: string
  disabled?: boolean
  iconOnly?: boolean
  block?: boolean
  /** `toggle` (default): a v-model choice. `actions`: plain buttons and links without a selected state. */
  mode?: 'toggle' | 'actions'
}>()
const emit = defineEmits<{ 'update:modelValue': [value: string]; select: [value: string] }>()
const hydrated = useHydrated()
const isActions = computed(() => props.mode === 'actions')

function isSelected(item: SegmentedItem) { return !isActions.value && item.value === props.modelValue }

function choose(item: SegmentedItem) {
  if (isActions.value) emit('select', item.value)
  else emit('update:modelValue', item.value)
}
</script>

<template>
  <div
    role="group"
    :aria-label="props.label"
    data-slot="segmented-control"
    :class="['gap-0.5 rounded-control bg-elevated p-1', props.block ? 'grid grid-flow-col auto-cols-fr' : 'inline-flex items-center']"
  >
    <UTooltip v-for="item in props.items" :key="item.value" :text="props.iconOnly ? item.label : undefined">
      <UButton
        type="button"
        color="neutral"
        size="sm"
        :block="props.block"
        :square="props.iconOnly"
        :to="isActions ? item.to : undefined"
        variant="ghost"
        :class="['h-8 min-h-8 rounded-inner text-[13px] font-medium [&:not([disabled],[aria-disabled=true])]:hover:translate-y-0 active:scale-100', props.iconOnly ? 'min-w-8 px-0' : 'px-3.5', isSelected(item) ? 'bg-default font-semibold text-highlighted shadow-xs ring ring-default hover:bg-default' : 'text-muted']"
        :icon="item.icon"
        :label="props.iconOnly ? undefined : item.label"
        :aria-label="props.iconOnly ? item.label : undefined"
        :aria-pressed="isActions ? undefined : item.value === props.modelValue"
        :disabled="props.disabled || item.disabled || (!hydrated && !(isActions && item.to))"
        :data-value="item.value"
        :data-testid="item.testId"
        @click="choose(item)"
      />
    </UTooltip>
  </div>
</template>
