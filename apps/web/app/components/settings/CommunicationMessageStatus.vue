<script setup lang="ts">
import type { IntegrationMessageStateView } from '@liwan/contracts'
import { messageCanRetry, messageStage, messageStageTone } from '@/utils/integrationMessaging'

// One message's state as the reader needs it: the badge, one line saying what it means (a `sent` message with no callback
// says no delivery receipt will come), the provider's error when there is one, and the retry. A `failed` message is sent
// again at once; an `unconfirmed` one may already have reached the provider, so its retry asks first and warns about
// the double send. `canRetry` is false for a caller who may not retry (it needs both manage and the log capability).
const props = defineProps<{
  message: Pick<IntegrationMessageStateView, 'state' | 'has_receipt' | 'error_code' | 'error_message'>
  canRetry?: boolean
  retrying?: boolean
}>()
const emit = defineEmits<{ retry: [] }>()
const { t } = useI18n()
const hydrated = useHydrated()

const stage = computed(() => messageStage(props.message))
const retryable = computed(() => props.canRetry && messageCanRetry(props.message))
const confirming = ref(false)

function retry() {
  confirming.value = false
  emit('retry')
}
</script>

<template>
  <div class="grid min-w-0 gap-2 text-start" :data-testid="`communication-message-${stage}`">
    <div class="flex flex-wrap items-center gap-2">
      <SharedStatusBadge :tone="messageStageTone(stage)" :label="t(`integrations.communications.message.stage.${stage}`)" data-testid="communication-message-badge" />
      <UButton
        v-if="retryable && message.state === 'failed'"
        size="sm" color="neutral" variant="outline" icon="i-lucide-rotate-ccw"
        :disabled="!hydrated || retrying" :loading="retrying" :label="t('integrations.communications.message.retry')" data-testid="communication-message-retry" @click="retry"
      />
      <UButton
        v-else-if="retryable && message.state === 'unconfirmed'"
        size="sm" color="neutral" variant="outline" icon="i-lucide-rotate-ccw"
        :disabled="!hydrated || retrying || confirming" :loading="retrying" :label="t('integrations.communications.message.retry')" data-testid="communication-message-retry" @click="confirming = true"
      />
    </div>
    <p class="text-sm text-muted" data-testid="communication-message-hint">{{ t(`integrations.communications.message.hint.${stage}`) }}</p>
    <p v-if="message.error_code || message.error_message" class="flex min-w-0 flex-wrap items-baseline gap-2 text-sm text-default" data-testid="communication-message-error">
      <code v-if="message.error_code" class="rounded-md bg-elevated px-1.5 py-0.5 text-xs" dir="ltr">{{ message.error_code }}</code>
      <bdi v-if="message.error_message" class="min-w-0 break-words">{{ message.error_message }}</bdi>
    </p>
    <SharedInlineConfirm
      v-if="confirming"
      :title="t('integrations.communications.message.retryUnconfirmedTitle')"
      :description="t('integrations.communications.message.retryUnconfirmedWarning')"
      :confirm-label="t('integrations.communications.message.retryUnconfirmedConfirm')"
      color="warning"
      :pending="retrying"
      @confirm="retry"
      @cancel="confirming = false"
    />
  </div>
</template>
