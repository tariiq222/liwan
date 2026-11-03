<script setup lang="ts">
import { useFormField } from '@nuxt/ui/composables'

// A 24-hour HH:MM entry. A native time input follows the browser locale and can render 12-hour
// with AM/PM, while every meeting read path prints 24-hour times, so the form and the record
// page must speak one clock. Anything incomplete is reported by the schedule validation.
const props = withDefaults(defineProps<{
  modelValue: string
  disabled?: boolean
  id?: string
  name?: string
  ariaLabel?: string
  ariaInvalid?: boolean
}>(), { disabled: false, id: undefined, name: undefined, ariaLabel: undefined, ariaInvalid: false })
const emit = defineEmits<{ 'update:modelValue': [value: string] }>()

const { ariaAttrs, emitFormBlur, emitFormFocus, emitFormInput, emitFormChange } = useFormField(props, { deferInputValidation: true })

function normalize(value: string) {
  return value.replace(/[^\d:]/g, '').slice(0, 5)
}

function onInput(value: unknown) {
  emit('update:modelValue', normalize(String(value)))
  emitFormInput()
  emitFormChange()
}
</script>

<template>
  <UInput
    :id="props.id"
    :model-value="props.modelValue"
    v-bind="ariaAttrs"
    dir="ltr"
    inputmode="numeric"
    maxlength="5"
    placeholder="HH:MM"
    class="w-full tabular-nums"
    :aria-label="props.ariaLabel"
    :aria-invalid="props.ariaInvalid || undefined"
    :disabled="props.disabled"
    @update:model-value="onInput"
    @focus="emitFormFocus"
    @blur="emitFormBlur"
  />
</template>
