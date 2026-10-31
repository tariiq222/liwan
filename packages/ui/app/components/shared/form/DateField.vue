<script setup lang="ts">
import { computed, useAttrs, useSlots } from 'vue'
import { formatCalendarDate, toCalendarDate } from '../../../composables/calendarDate'
import { useFormField } from '@nuxt/ui/composables'
defineOptions({ inheritAttrs: false })
// `label` replaces the formatted date on the trigger (for example a date and a
// time); the `footer` slot adds controls under the calendar, such as a time
// input, and keeps the popover open after a day is picked.
const props = defineProps<{ modelValue: string | null; disabled?: boolean; id?: string; name?: string; ariaLabel?: string; minValue?: string | null; maxValue?: string | null; label?: string }>()
const emit = defineEmits<{ 'update:modelValue': [value: string | null] }>()
const { t } = useI18n()
const attrs = useAttrs()
const slots = useSlots()
const open = ref(false)
const hydrated = useHydrated()
const { id, name, color: formFieldColor, highlight: formFieldHighlight, disabled: formFieldDisabled, emitFormBlur, emitFormChange, emitFormFocus, emitFormInput, ariaAttrs } = useFormField(props, { deferInputValidation: true })
const date = computed({
  get: () => toCalendarDate(props.modelValue),
  set: (value: ReturnType<typeof toCalendarDate> | null) => {
    emit('update:modelValue', value?.toString() || null)
    emitFormInput()
    emitFormChange()
    if (!slots.footer) open.value = false
  },
})
const text = computed(() => props.label || formatCalendarDate(props.modelValue) || t('app.selectDate'))
const buttonAttrs = computed(() => {
  const formAttrs = ariaAttrs.value ?? {}
  const describedBy = [attrs['aria-describedby'], formAttrs['aria-describedby']].filter(Boolean).join(' ')
  const invalid = formAttrs['aria-invalid'] || attrs['aria-invalid']
  return {
    ...attrs,
    ...formAttrs,
    ...(invalid !== undefined ? { 'aria-invalid': invalid } : {}),
    ...(describedBy ? { 'aria-describedby': describedBy } : {}),
    ...(props.ariaLabel ? { 'aria-label': `${props.ariaLabel}: ${text.value}` } : {}),
  }
})
</script>
<template>
  <UPopover v-model:open="open">
    <UButton v-bind="buttonAttrs" :id="id" :name="name" type="button" :color="formFieldColor || 'neutral'" variant="outline" class="w-full justify-start font-normal" icon="i-lucide-calendar-days" :label="text" :highlight="formFieldHighlight" :disabled="formFieldDisabled || !hydrated" @focus="emitFormFocus" @blur="emitFormBlur" />
    <template #content>
      <UCalendar v-model="date" class="p-2" :disabled="formFieldDisabled" :min-value="toCalendarDate(minValue ?? null)" :max-value="toCalendarDate(maxValue ?? null)" />
      <div v-if="modelValue || $slots.footer" class="flex items-center justify-end gap-2 border-t border-default p-2">
        <slot name="footer" />
        <UButton v-if="modelValue" type="button" color="error" variant="ghost" square icon="i-lucide-trash-2" :aria-label="t('app.clearDate')" :title="t('app.clearDate')" :disabled="formFieldDisabled" @click="date = undefined" />
      </div>
    </template>
  </UPopover>
</template>
