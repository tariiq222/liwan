<script setup lang="ts">
import type { AiLimit } from '@/composables/useAiRun'

const props = defineProps<{
  limit: AiLimit
  used?: number
  max?: number | null
}>()
const { t } = useI18n()
const { can } = useAccess()
const TEXT: Record<AiLimit, string> = {
  messages_monthly: 'ai.limits.monthly',
  messages_per_user: 'ai.limits.perUser',
  setup_monthly: 'ai.limits.setupMonthly',
  tokens_monthly: 'ai.limits.tokensMonthly',
  output_tokens: 'ai.limits.outputTokens',
  consent_required: 'ai.limits.consentRequired',
  tenant_key_missing: 'ai.limits.tenantKeyMissing',
  timeout: 'ai.limits.timeout',
  max_tool_calls: 'ai.limits.run',
  max_steps: 'ai.limits.run',
}
const text = computed(() => t(TEXT[props.limit]))
// A policy refusal is fixed in the AI settings: whoever may change them gets the way there.
const settingsLink = computed(() => (props.limit === 'consent_required' || props.limit === 'tenant_key_missing') && can('ai.settings.manage'))
</script>

<template>
  <UAlert role="alert" color="warning" variant="subtle" icon="i-lucide-gauge" :title="text" data-testid="ai-limit">
    <template v-if="(props.used !== undefined && props.max != null) || settingsLink" #description>
      <p v-if="props.used !== undefined && props.max != null">{{ t('ai.limits.used', { used: props.used, limit: props.max }) }}</p>
      <ULink v-if="settingsLink" to="/settings/apps/ai" class="underline">{{ t('ai.limits.openSettings') }}</ULink>
    </template>
  </UAlert>
</template>
