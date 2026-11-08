<script setup lang="ts">
// The prompt box (24px surface, 1.5px border, soft shadow): the field, then a row with the default slot (the starter
// chips of an empty conversation) and the send button at the inline-end. Enter sends, Shift+Enter inserts a newline;
// the full prompt has two rows; `compact` (the sheet and an open conversation) is one row in a smaller box. The line under the
// field reminds users not to type sensitive data: free text cannot be fully scanned (spec 2026-11-04 §6.12).
const props = defineProps<{
  disabled: boolean
  pending: boolean
  compact?: boolean
}>()
const emit = defineEmits<{ send: [text: string] }>()
const { t } = useI18n()
const text = ref('')
const noticeId = useId()
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
  <div class="grid gap-1.5">
    <form
      class="flex flex-col gap-3 border-[1.5px] border-default bg-default focus-within:border-(--primary-solid)"
      :class="props.compact ? 'rounded-card p-3' : 'rounded-surface p-[18px] shadow-[0_24px_60px_rgb(20_16_42/10%)] dark:shadow-[0_24px_50px_-18px_rgb(0_0_0/55%)]'"
      @submit.prevent="submit"
    >
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
        :aria-describedby="noticeId"
        :ui="{ base: props.compact ? 'w-full resize-none px-1 py-1' : 'w-full resize-none px-1 py-1 text-(length:--liwan-fs-conversation-title)' }"
        data-testid="ai-composer"
        @keydown="onKeydown"
      />
      <div class="flex flex-wrap items-center gap-2">
        <slot />
        <UButton
          type="submit"
          class="liwan-touch-target ms-auto shrink-0"
          icon="i-lucide-send"
          :size="props.compact ? 'md' : 'lg'"
          :label="props.compact ? undefined : t(props.pending ? 'ai.composer.sending' : 'ai.composer.send')"
          :disabled="!canSend"
          :loading="props.pending"
          :aria-label="t(props.pending ? 'ai.composer.sending' : 'ai.composer.send')"
          data-testid="ai-send"
        />
      </div>
    </form>
    <p :id="noticeId" class="px-1 text-xs text-muted" data-testid="ai-composer-notice">{{ t('ai.composer.notice') }}</p>
  </div>
</template>
