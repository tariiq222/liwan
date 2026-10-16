<script setup lang="ts">
const props = defineProps<{
  disabled: boolean
  pending: boolean
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

// Enter sends, Shift+Enter inserts a newline. An IME composition's Enter only confirms the composition.
function onKeydown(event: KeyboardEvent) {
  if (event.key !== 'Enter' || event.shiftKey || event.isComposing) return
  event.preventDefault()
  submit()
}
</script>

<template>
  <form class="flex items-end gap-2" @submit.prevent="submit">
    <UTextarea
      v-model="text"
      class="min-w-0 flex-1"
      :rows="1"
      autoresize
      :maxrows="8"
      :disabled="blocked"
      :placeholder="t('ai.composer.placeholder')"
      :aria-label="t('ai.composer.placeholder')"
      :ui="{ base: 'w-full' }"
      data-testid="ai-composer"
      @keydown="onKeydown"
    />
    <UButton type="submit" :disabled="!canSend" :loading="props.pending" :label="t(props.pending ? 'ai.composer.sending' : 'ai.composer.send')" data-testid="ai-send" />
  </form>
</template>
