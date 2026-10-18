<template>
  <SharedFilterField :label="label">
    <SharedSegmentedControl
      v-if="layout === 'segment'"
      block
      :label="label"
      :items="items"
      :model-value="singleValue"
      :disabled="disabled"
      @update:model-value="select"
    />
    <div v-else class="flex flex-wrap gap-1.5">
      <UButton
        v-for="item in items"
        :key="item.value"
        type="button"
        size="sm"
        :color="isSelected(item.value) ? 'primary' : 'neutral'"
        :variant="isSelected(item.value) ? 'soft' : 'outline'"
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
  /** A string for single choice, an array for multiple choice (chips only: the segment layout is single choice). */
  modelValue: string | string[]
  layout?: 'chips' | 'segment'
  disabled?: boolean
}>(), {
  layout: 'chips',
  disabled: false,
})
const emit = defineEmits<{ 'update:modelValue': [string | string[]] }>()

const singleValue = computed(() => Array.isArray(props.modelValue) ? '' : props.modelValue)
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
