<script setup lang="ts">
import { computed, useAttrs } from 'vue'
import { formatCalendarDate, toCalendarDate } from '@/composables/calendarDate'
import { useFormField } from '@nuxt/ui/composables'
defineOptions({ inheritAttrs: false })
const props = defineProps<{ modelValue: string | null; disabled?: boolean; id?: string; name?: string; ariaLabel?: string; minValue?: string | null; maxValue?: string | null }>()
const emit = defineEmits<{ 'update:modelValue': [value: string | null] }>()
const { t, locale } = useI18n()
const attrs = useAttrs()
const open = ref(false)
const hydrated = useHydrated()
const { id, name, color: formFieldColor, highlight: formFieldHighlight, disabled: formFieldDisabled, emitFormBlur, emitFormChange, emitFormFocus, emitFormInput, ariaAttrs } = useFormField(props, { deferInputValidation: true })
const date = computed({
  get: () => toCalendarDate(props.modelValue),
  set: (value: ReturnType<typeof toCalendarDate> | null) => {
    emit('update:modelValue', value?.toString() || null)
    emitFormInput()
    emitFormChange()
    open.value = false
  },
})
const text = computed(() => formatCalendarDate(props.modelValue, locale.value) || t('app.selectDate'))
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
      <div v-if="modelValue" class="flex justify-end p-2">
        <UButton type="button" color="error" variant="ghost" square icon="i-lucide-trash-2" :aria-label="t('app.clearDate')" :title="t('app.clearDate')" :disabled="formFieldDisabled" @click="date = undefined" />
      </div>
    </template>
  </UPopover>
</template>
