<script setup lang="ts">
import type { CompanyProfileExtension } from '@webvue/contracts'

// One field an installed application adds to the company profile: a text input, or a select over the server's options.
const props = defineProps<{
  extension: CompanyProfileExtension
  modelValue: string | number | null
  error?: string
  disabled: boolean
}>()
const emit = defineEmits<{ 'update:modelValue': [value: string | null] }>()

const text = computed({
  get: () => (props.modelValue as string | null) ?? '',
  set: (value: string) => emit('update:modelValue', value),
})
const options = computed(() => (props.extension.kind === 'selection' ? props.extension.options : []).map(option => ({ value: option.value, label: option.label })))
</script>

<template>
  <UFormField :name="extension.name" :label="extension.label" :error="error">
    <USelect
      v-if="extension.kind === 'selection'"
      :id="`company-${extension.name}`"
      :model-value="(modelValue as string | null) ?? undefined"
      class="w-full"
      :items="options"
      :data-testid="`company-${extension.name}`"
      :disabled="disabled"
      @update:model-value="emit('update:modelValue', ($event as string | undefined) ?? null)"
    />
    <UInput v-else :id="`company-${extension.name}`" v-model="text" class="w-full" dir="ltr" :inputmode="extension.inputmode" :data-testid="`company-${extension.name}`" :disabled="disabled" />
  </UFormField>
</template>
