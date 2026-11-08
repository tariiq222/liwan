<script setup lang="ts">
import { resolveInlineDraft } from '../../../utils/inlineEdit'

/*
 * A value that reads as plain text and edits in place (record titles, short numbers): the text is a button named by
 * `label`; activating it swaps in one input. Enter or leaving the field saves, Escape puts the saved value back.
 * It sends nothing: `save` hands the app the trimmed draft, and a draft that is empty (unless `allowEmpty`) or equal
 * to the saved value is dropped. Focus returns to the button after Enter or Escape; after a blur it stays where the
 * reader moved. A polite live region announces a save (`app.saved`).
 */
const props = withDefaults(defineProps<{
  modelValue: string
  /** The accessible name of the button and the input (what is being edited). */
  label: string
  editable?: boolean
  /** Shown instead of an empty value. */
  placeholder?: string
  type?: 'text' | 'number'
  min?: number
  max?: number
  step?: number
  allowEmpty?: boolean
  /** `data-testid` of the input while editing. */
  inputTestId?: string
  /** Width classes of the input while editing; it fills its box by default. */
  inputClass?: string
}>(), { editable: true, type: 'text', allowEmpty: false })
const emit = defineEmits<{ save: [value: string] }>()

const { t } = useI18n()
const hydrated = useHydrated()
const editing = ref(false)
const draft = ref(props.modelValue)
const announcement = ref('')
const input = useTemplateRef<{ inputRef?: HTMLInputElement | null }>('input')
const button = useTemplateRef<HTMLButtonElement>('button')
const canEdit = computed(() => props.editable && hydrated.value)

watch(() => props.modelValue, (value) => { if (!editing.value) draft.value = value })

function start() {
  if (!canEdit.value) return
  draft.value = props.modelValue
  announcement.value = ''
  editing.value = true
  nextTick(() => {
    const field = input.value?.inputRef
    field?.focus()
    field?.select()
  })
}

function leave(returnFocus: boolean) {
  editing.value = false
  if (returnFocus) nextTick(() => button.value?.focus())
}

function commit(returnFocus: boolean) {
  if (!editing.value) return
  const value = resolveInlineDraft(draft.value, props.modelValue, props.allowEmpty)
  leave(returnFocus)
  if (value === null) {
    draft.value = props.modelValue
    return
  }
  emit('save', value)
  announcement.value = t('app.saved')
}

function cancel() {
  draft.value = props.modelValue
  leave(true)
}
</script>

<template>
  <span data-slot="inline-text" class="inline-flex min-w-0 max-w-full items-center">
    <UInput
      v-if="editing"
      ref="input"
      :model-value="draft"
      :type="props.type"
      :min="props.min"
      :max="props.max"
      :step="props.step"
      size="md"
      :class="['min-w-0', props.inputClass ?? 'w-full']"
      :aria-label="props.label"
      :data-testid="props.inputTestId"
      @update:model-value="draft = String($event ?? '')"
      @blur="commit(false)"
      @keydown.enter.prevent="commit(true)"
      @keydown.escape.stop.prevent="cancel"
    />
    <button
      v-else-if="props.editable"
      ref="button"
      type="button"
      class="min-w-0 max-w-full rounded-inner px-1.5 text-start wrap-anywhere transition-colors hover:bg-elevated focus-visible:outline-2 focus-visible:outline-primary disabled:cursor-default motion-reduce:transition-none"
      :class="props.modelValue ? '' : 'text-muted'"
      :disabled="!hydrated"
      :aria-label="`${props.label}: ${props.modelValue || props.placeholder || ''}`"
      @click="start"
    >
      <slot>{{ props.modelValue || props.placeholder }}</slot>
    </button>
    <span v-else class="min-w-0 wrap-anywhere" :class="props.modelValue ? '' : 'text-muted'"><slot>{{ props.modelValue || props.placeholder }}</slot></span>
    <span class="sr-only" role="status" aria-live="polite">{{ announcement }}</span>
  </span>
</template>
