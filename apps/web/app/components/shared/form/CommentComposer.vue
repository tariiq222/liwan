<script setup lang="ts">
// The compose form of a comment: one textarea and a submit button. It keeps no draft of its own
// (`v-model` is the app's) and sends nothing: the app owns validation, the request and the
// in-flight guard, and reports them through `invalid`, `problem`, `error` and `pending`.
// Apps that complete `@` / `/` references hang their suggestion menu on the `below` slot and
// the textarea events, and pass the combobox ARIA through `textareaAria`.
const props = withDefaults(defineProps<{
  modelValue: string
  placeholder: string
  submitLabel: string
  label?: string
  help?: string
  fieldId?: string
  pending?: boolean
  invalid?: boolean
  problem?: string
  error?: string
  maxLength?: number
  textareaAria?: Record<string, string | undefined>
}>(), { pending: false, invalid: false })
const emit = defineEmits<{
  'update:modelValue': [value: string]
  submit: []
  keydown: [event: KeyboardEvent]
  input: [event: Event]
  click: [event: Event]
  keyup: [event: Event]
  blur: []
}>()

const hydrated = useHydrated()
const generatedId = useId()
const textareaId = computed(() => props.fieldId ?? `comment-${generatedId}`)
</script>

<template>
  <form class="grid gap-2" @submit.prevent="emit('submit')">
    <UFormField v-if="label" :label="label" :name="textareaId" :help="help" class="text-xs font-medium">
      <div>
        <UTextarea
          :id="textareaId"
          :model-value="modelValue"
          :placeholder="placeholder"
          :disabled="!hydrated || pending"
          class="min-h-22 w-full resize-none"
          v-bind="textareaAria"
          @update:model-value="emit('update:modelValue', String($event ?? ''))"
          @keydown="emit('keydown', $event)"
          @input="emit('input', $event)"
          @click="emit('click', $event)"
          @keyup="emit('keyup', $event)"
          @blur="emit('blur')"
        />
        <slot name="below" />
      </div>
    </UFormField>
    <template v-else>
      <UTextarea
        :id="textareaId"
        :model-value="modelValue"
        :placeholder="placeholder"
        :aria-label="placeholder"
        :maxlength="maxLength"
        :disabled="!hydrated || pending"
        class="min-h-22 w-full resize-none"
        v-bind="textareaAria"
        @update:model-value="emit('update:modelValue', String($event ?? ''))"
        @keydown="emit('keydown', $event)"
        @input="emit('input', $event)"
        @click="emit('click', $event)"
        @keyup="emit('keyup', $event)"
        @blur="emit('blur')"
      />
      <slot name="below" />
    </template>
    <p v-if="problem" role="alert" class="text-sm text-error">{{ problem }}</p>
    <p v-if="error" role="alert" class="text-sm text-error">{{ error }}</p>
    <SharedFormActions class="flex justify-end">
      <UButton type="submit" size="sm" :loading="pending" :disabled="!hydrated || pending || !modelValue.trim() || invalid" :label="submitLabel" />
    </SharedFormActions>
  </form>
</template>
