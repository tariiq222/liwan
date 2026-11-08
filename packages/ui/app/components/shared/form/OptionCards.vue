<script setup lang="ts">
/*
 * Options that each need an explanation (DESIGN.md §6, settings pages): full-width stacked selectable cards, each with a
 * title and a description. The chosen card takes the application colour as its border and a light tint of it (ink for a
 * free application); a radio dot sits inside. It is a native radio group, so Tab, the arrow keys and Space work as in any
 * radio group. A card can be disabled with its own reason.
 */
export interface OptionCard { value: string; label: string; description?: string; disabled?: boolean; disabledReason?: string }

const props = defineProps<{
  modelValue?: string
  options: OptionCard[]
  /** The accessible name of the group. */
  label: string
  disabled?: boolean
  name?: string
}>()
const emit = defineEmits<{ 'update:modelValue': [value: string] }>()
const hydrated = useHydrated()
const group = props.name ?? useId()
</script>

<template>
  <div role="radiogroup" :aria-label="props.label" class="grid gap-2.5" data-slot="option-cards">
    <label
      v-for="option in props.options"
      :key="option.value"
      class="liwan-option-card"
      :data-selected="option.value === props.modelValue ? 'true' : undefined"
      :data-disabled="props.disabled || option.disabled || !hydrated ? 'true' : undefined"
    >
      <input
        type="radio"
        class="sr-only"
        :name="group"
        :value="option.value"
        :checked="option.value === props.modelValue"
        :disabled="props.disabled || option.disabled || !hydrated"
        @change="emit('update:modelValue', option.value)"
      >
      <span class="liwan-option-dot" aria-hidden="true" />
      <span class="min-w-0 flex-1">
        <span class="block text-sm font-medium text-highlighted">{{ option.label }}</span>
        <span v-if="option.description" class="mt-0.5 block text-sm text-muted">{{ option.description }}</span>
        <span v-if="option.disabledReason" class="mt-1 block text-sm text-status-warning-foreground">{{ option.disabledReason }}</span>
      </span>
    </label>
  </div>
</template>
