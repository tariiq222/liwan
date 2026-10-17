<script setup lang="ts">
/*
 * The one round segmented group (DESIGN.md §6): a full-pill container (ring + faint fill) with one pill button per
 * option, the chosen one `soft`, the rest `ghost`. It is a labelled group of toggle buttons (`aria-pressed`), bound
 * with v-model. Used for scopes (open/closed, active/archived), kinds, groupings, scales and, icon-only, the list
 * view switch. Waits for hydration like every interactive control.
 *
 * `icon-only` draws square icon buttons with a tooltip (the label stays the accessible name); `block` makes the group
 * fill its row with equal segments. Attributes (`data-testid`) land on the group.
 */
export interface SegmentedItem { value: string; label: string; icon?: string; testId?: string; disabled?: boolean }

const props = defineProps<{
  modelValue: string
  items: SegmentedItem[]
  /** The accessible name of the group. */
  label: string
  disabled?: boolean
  iconOnly?: boolean
  block?: boolean
}>()
const emit = defineEmits<{ 'update:modelValue': [value: string] }>()
const hydrated = useHydrated()
</script>

<template>
  <div
    role="group"
    :aria-label="props.label"
    data-slot="segmented-control"
    :class="['gap-0.5 rounded-full bg-elevated/40 p-0.5 ring ring-default', props.block ? 'grid grid-flow-col auto-cols-fr' : 'inline-flex items-center']"
  >
    <UTooltip v-for="item in props.items" :key="item.value" :text="props.iconOnly ? item.label : undefined">
      <UButton
        type="button"
        color="neutral"
        size="sm"
        :block="props.block"
        :square="props.iconOnly"
        :variant="item.value === props.modelValue ? 'soft' : 'ghost'"
        :icon="item.icon"
        :label="props.iconOnly ? undefined : item.label"
        :aria-label="props.iconOnly ? item.label : undefined"
        :aria-pressed="item.value === props.modelValue"
        :disabled="props.disabled || item.disabled || !hydrated"
        :data-value="item.value"
        :data-testid="item.testId"
        @click="emit('update:modelValue', item.value)"
      />
    </UTooltip>
  </div>
</template>
