<script setup lang="ts">
import type { AiLimit } from '@/composables/useAiRun'

const props = defineProps<{
  limit: AiLimit
  /** When the refusal lifts by itself (the allowance renewal, the month's end), as the ISO instant Odoo sends; null otherwise. */
  resetsAt?: string | null
}>()
const { t, d } = useI18n()
const { can } = useAccess()
const TEXT: Record<AiLimit, string> = {
  messages_monthly: 'ai.limits.monthly',
  messages_per_user: 'ai.limits.perUser',
  assist_monthly: 'ai.limits.assistMonthly',
  balance_empty: 'ai.limits.balanceEmpty',
  spend_ceiling: 'ai.limits.spendCeiling',
  output_tokens: 'ai.limits.outputTokens',
  input_tokens: 'ai.limits.inputTokens',
  consent_required: 'ai.limits.consentRequired',
  tenant_key_missing: 'ai.limits.tenantKeyMissing',
  timeout: 'ai.limits.timeout',
  max_tool_calls: 'ai.limits.run',
  max_steps: 'ai.limits.run',
}
const text = computed(() => t(TEXT[props.limit]))
const renewsAt = computed(() => (props.resetsAt ? d(new Date(props.resetsAt), { dateStyle: 'medium' }) : null))
// A refusal whose fix is a setting on the AI settings page links there (the acknowledgement, the key): only whoever may change
// them gets the link. The balance (a top-up) and the spend ceiling have no control on a customer page yet (slices 7 and 9), so
// their notice explains the state and links nowhere rather than to a page that cannot change it.
const settingsLink = computed(() => (props.limit === 'consent_required' || props.limit === 'tenant_key_missing') && can('ai.settings.manage'))
</script>

<template>
  <UAlert role="alert" color="warning" variant="subtle" icon="i-lucide-gauge" :title="text" data-testid="ai-limit">
    <template v-if="renewsAt || settingsLink" #description>
      <p v-if="renewsAt">{{ t('ai.limits.renewsAt', { at: renewsAt }) }}</p>
      <ULink v-if="settingsLink" to="/settings/apps/ai" class="underline">{{ t('ai.limits.openSettings') }}</ULink>
    </template>
  </UAlert>
</template>
