<script setup lang="ts">
import type { IntegrationCallStateView } from '@liwan/contracts'
import { callStageTone } from '@/utils/integrationVoice'

// One call's state as the reader needs it: the badge, one line saying what it means, and the provider's error when
// there is one. An `unconfirmed` call may be going out to the recipient: it is never placed again automatically, and
// the line tells the reader to check Twilio before placing anything on that number again. There is no retry route
// for calls: a second call is a new one that bills the company again.
const props = defineProps<{ call: Pick<IntegrationCallStateView, 'state' | 'error_code' | 'error_message'> }>()
const { t } = useI18n()

const unconfirmed = computed(() => props.call.state === 'unconfirmed')
</script>

<template>
  <div class="grid min-w-0 gap-2 text-start" :data-testid="`communication-call-${call.state}`">
    <SharedStatusBadge :tone="callStageTone(call.state)" :label="t(`integrations.communications.call.stage.${call.state}`)" data-testid="communication-call-badge" />
    <p class="text-sm text-muted" data-testid="communication-call-hint">{{ t(`integrations.communications.call.hint.${call.state}`) }}</p>
    <UAlert
      v-if="unconfirmed" role="warning" color="warning" variant="subtle" icon="i-lucide-triangle-alert"
      :title="t('integrations.communications.call.unconfirmedWarning')" data-testid="communication-call-unconfirmed-warning"
    />
    <p v-if="call.error_code || call.error_message" class="flex min-w-0 flex-wrap items-baseline gap-2 text-sm text-default" data-testid="communication-call-error">
      <code v-if="call.error_code" class="rounded-md bg-elevated px-1.5 py-0.5 text-xs" dir="ltr">{{ call.error_code }}</code>
      <bdi v-if="call.error_message" class="min-w-0 break-words">{{ call.error_message }}</bdi>
    </p>
  </div>
</template>
