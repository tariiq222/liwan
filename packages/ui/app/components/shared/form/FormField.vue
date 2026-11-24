<script setup lang="ts">
/*
 * The one field wrapper of a form (DESIGN.md §6): `UFormField` plus the three behaviours every form needs.
 * - A required field marks its control `aria-required="true"` (the asterisk of the label is visual only).
 * - Validation shows on blur: the live `error` appears once the reader has left the field, or at once after a submit
 *   attempt (`submitted`), so a field is never accused while it is still being typed.
 * - The field is addressable by `name` (`data-field`, `id="field-<name>"`) so `SharedErrorSummary` can move focus to it.
 * `UFormField` already links the control to its error and help text (`aria-invalid`, `aria-describedby`); nothing here
 * repeats that. All text arrives as props or slots.
 */
const props = defineProps<{
  label?: string
  /** The field's name; the target of the error summary's link. */
  name?: string
  required?: boolean
  help?: string
  /** The live validation message; shown after blur or once `submitted`. */
  error?: string | false
  /** The form was submitted at least once: show every error, touched or not. */
  submitted?: boolean
}>()

const field = ref<{ $el: HTMLElement } | null>(null)
const touched = ref(false)
const shownError = computed(() => (props.error && (touched.value || props.submitted) ? props.error : undefined))

// UFormField draws the required asterisk but gives the control no required state; assistive technology reads this one.
const CONTROLS = 'input, textarea, select, [role="combobox"]'
function markRequired() {
  if (!props.required) return
  for (const control of field.value?.$el?.querySelectorAll(CONTROLS) ?? []) control.setAttribute('aria-required', 'true')
}
onMounted(markRequired)
onUpdated(markRequired)

function onBlur() {
  touched.value = true
}
</script>

<template>
  <UFormField
    ref="field"
    :id="props.name ? `field-${props.name}` : undefined"
    :label="props.label"
    :name="props.name"
    :required="props.required"
    :help="props.help"
    :error="shownError"
    :data-field="props.name"
    @focusout="onBlur"
  >
    <template v-if="$slots.label" #label><slot name="label" /></template>
    <slot />
  </UFormField>
</template>
