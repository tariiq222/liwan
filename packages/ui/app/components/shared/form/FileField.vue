<script setup lang="ts">
import { computed, useAttrs } from 'vue'
import { useFormField } from '@nuxt/ui/composables'

defineOptions({ inheritAttrs: false })

const props = withDefaults(defineProps<{
  accept?: string
  label?: string
  showFileName?: boolean
  ariaLabel?: string
  disabled?: boolean
  id?: string
  name?: string
}>(), {
  disabled: false,
  showFileName: true,
})

const emit = defineEmits<{ change: [event: Event] }>()
const { t } = useI18n()
const attrs = useAttrs()
const input = ref<HTMLInputElement | null>(null)
const fileName = ref('')
const { id, name, color: formFieldColor, highlight: formFieldHighlight, disabled: formFieldDisabled, emitFormBlur, emitFormChange, emitFormFocus, emitFormInput, ariaAttrs } = useFormField(props, { deferInputValidation: true })
const fileLabel = computed(() => fileName.value || t('app.noFileChosen'))
const inputId = computed(() => id.value ? `${id.value}-input` : undefined)
const buttonAttrs = computed(() => {
  const formAttrs = ariaAttrs.value ?? {}
  const describedBy = [attrs['aria-describedby'], formAttrs['aria-describedby']].filter(Boolean).join(' ')
  const invalid = formAttrs['aria-invalid'] || attrs['aria-invalid']
  const restAttrs = { ...attrs }
  delete restAttrs.class
  return {
    ...restAttrs,
    ...formAttrs,
    ...(invalid !== undefined ? { 'aria-invalid': invalid } : {}),
    ...(describedBy ? { 'aria-describedby': describedBy } : {}),
  }
})

function reset() {
  fileName.value = ''
  if (input.value) input.value.value = ''
}

defineExpose({ reset })

function openPicker() {
  if (formFieldDisabled.value) return
  input.value?.click()
}

function onChange(event: Event) {
  const target = event.target as HTMLInputElement | null
  fileName.value = target?.files?.[0]?.name ?? ''
  emitFormInput()
  emitFormChange()
  emit('change', event)
}
</script>

<template>
  <input
    ref="input"
    :id="inputId"
    :name="name"
    type="file"
    class="hidden"
    tabindex="-1"
    :accept="accept"
    :disabled="formFieldDisabled"
    @change="onChange"
    @focus="emitFormFocus"
    @blur="emitFormBlur"
  >
  <div class="flex min-w-0 items-center gap-2" :class="attrs.class">
    <UButton
      v-bind="buttonAttrs"
      :id="id"
      type="button"
      :color="formFieldColor || 'neutral'"
      variant="outline"
      class="shrink-0"
      icon="i-lucide-paperclip"
      :label="props.label || t('app.chooseFile')"
      :aria-label="ariaLabel"
      :aria-controls="inputId"
      :highlight="formFieldHighlight"
      :disabled="formFieldDisabled"
      @click="openPicker"
      @focus="emitFormFocus"
      @blur="emitFormBlur"
    />
    <span v-if="props.showFileName" class="min-w-0 flex-1 truncate text-sm text-muted" :title="fileLabel">{{ fileLabel }}</span>
  </div>
</template>
