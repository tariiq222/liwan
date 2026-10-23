<script setup lang="ts">
// Enter sends, Shift+Enter inserts a newline; the full page has two rows, the sheet (`compact`) one.
const props = defineProps<{
  disabled: boolean
  pending: boolean
  compact?: boolean
}>()
const emit = defineEmits<{ send: [text: string] }>()
const { t } = useI18n()
const text = ref('')
const blocked = computed(() => props.disabled || props.pending)
const canSend = computed(() => !blocked.value && text.value.trim().length > 0)

function submit() {
  if (!canSend.value) return
  emit('send', text.value.trim())
  text.value = ''
}

// An IME composition's Enter only confirms the composition.
function onKeydown(event: KeyboardEvent) {
  if (event.key !== 'Enter' || event.shiftKey || event.isComposing) return
  event.preventDefault()
  submit()
}
</script>

<template>
  <form class="flex items-end gap-2 rounded-card bg-default p-3 ring ring-accented focus-within:ring-2 focus-within:ring-primary" @submit.prevent="submit">
    <UTextarea
      v-model="text"
      class="min-w-0 flex-1"
      variant="none"
      :rows="props.compact ? 1 : 2"
      autoresize
      :maxrows="8"
      :disabled="blocked"
      :placeholder="t('ai.composer.placeholder')"
      :aria-label="t('ai.composer.placeholder')"
      :ui="{ base: 'w-full resize-none px-1 py-1' }"
      data-testid="ai-composer"
      @keydown="onKeydown"
    />
    <UButton
      type="submit"
      class="webvue-touch-target shrink-0 rounded-full"
      icon="i-lucide-arrow-up"
      size="lg"
      :disabled="!canSend"
      :loading="props.pending"
      :aria-label="t(props.pending ? 'ai.composer.sending' : 'ai.composer.send')"
      data-testid="ai-send"
    />
  </form>
</template>
