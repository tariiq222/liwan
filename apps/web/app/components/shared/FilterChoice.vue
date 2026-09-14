<template>
  <SharedFilterField :label="label">
    <div :class="layout === 'segment' ? 'inline-flex items-center gap-0.5 rounded-md p-0.5 ring ring-default bg-default w-full' : 'flex flex-wrap gap-1.5'">
      <UButton
        v-for="item in items"
        :key="item.value"
        type="button"
        size="sm"
        :class="layout === 'segment' ? 'flex-1 justify-center' : undefined"
        :color="layout === 'chips' && isSelected(item.value) ? 'primary' : 'neutral'"
        :variant="isSelected(item.value) ? 'soft' : layout === 'segment' ? 'ghost' : 'outline'"
        :aria-pressed="isSelected(item.value)"
        :disabled="disabled || item.disabled"
        :label="item.label"
        @click="select(item.value)"
      />
    </div>
  </SharedFilterField>
</template>

<script setup lang="ts">
export interface FilterChoiceItem {
  value: string
  label: string
  disabled?: boolean
}

const props = withDefaults(defineProps<{
  label: string
  items: FilterChoiceItem[]
  /** A string for single choice, an array for multiple choice. */
  modelValue: string | string[]
  layout?: 'chips' | 'segment'
  disabled?: boolean
}>(), {
  layout: 'chips',
  disabled: false,
})
const emit = defineEmits<{ 'update:modelValue': [string | string[]] }>()

function isSelected(value: string) {
  return Array.isArray(props.modelValue) ? props.modelValue.includes(value) : props.modelValue === value
}
function select(value: string) {
  if (!Array.isArray(props.modelValue)) {
    emit('update:modelValue', value)
    return
  }
  emit('update:modelValue', isSelected(value) ? props.modelValue.filter(item => item !== value) : [...props.modelValue, value])
}
</script>
