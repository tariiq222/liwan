<script setup lang="ts">
/*
 * One money input (DESIGN.md §6): the number owns an `ltr` box with the decimal keypad, and the currency unit sits beside
 * the box, never inside it. A trailing slot of the input would sit on the reader's end, which in RTL is the left edge
 * where an `ltr` number starts, so the two overlapped; a sibling cannot. The unit comes from `unit` (the page's
 * currency, never hardcoded here) and is visual only; the same unit reaches assistive technology through the label.
 * Validation behaviour (aria-required, blur, error) is `SharedFormField`'s.
 */
import FormField from './FormField.vue'

const model = defineModel<string>({ required: true })
const props = defineProps<{
  label: string
  /** The unit drawn beside the number, such as the currency symbol; without it (and without `unitLabel`) no unit is drawn or spoken. */
  unit?: string
  /** The unit as it is spoken when it differs from the symbol; defaults to `unit`. */
  unitLabel?: string
  name?: string
  required?: boolean
  help?: string
  error?: string | false
  submitted?: boolean
  disabled?: boolean
  placeholder?: string
  /** The amount is whole units (no decimals): the numeric keypad instead of the decimal one. */
  whole?: boolean
}>()
const spokenUnit = computed(() => props.unitLabel ?? props.unit)
</script>

<template>
  <FormField :label="props.label" :name="props.name" :required="props.required" :help="props.help" :error="props.error" :submitted="props.submitted">
    <template #label>{{ props.label }}<span v-if="spokenUnit" class="sr-only"> ({{ spokenUnit }})</span></template>
    <div class="flex items-center gap-2" data-slot="money-input">
      <UInput v-model="model" dir="ltr" :inputmode="props.whole ? 'numeric' : 'decimal'" class="min-w-0 flex-1" :disabled="props.disabled" :placeholder="props.placeholder" />
      <span v-if="props.unit" class="shrink-0 text-sm text-muted" aria-hidden="true" data-slot="money-unit">{{ props.unit }}</span>
      <slot name="after" />
    </div>
  </FormField>
</template>
