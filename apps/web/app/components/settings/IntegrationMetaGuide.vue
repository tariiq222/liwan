<script setup lang="ts">
import type { IntegrationConnection } from '@liwan/contracts'

// The step guide for connecting WhatsApp (Meta Cloud API). Before the account is saved it only teaches; after, each step
// shows what the stored connection really reports (its state, the checked time and which secrets are present) and the
// rest says it cannot be checked from here. Nothing here calls Meta or the server.
const props = defineProps<{ connection?: IntegrationConnection }>()
const { t } = useI18n()

type StepState = 'todo' | 'done' | 'problem' | 'pending' | 'unchecked'
interface Step { key: string, state: StepState | null, result: string }

// The permissions and the webhook fields are Meta's own identifiers, so they are not translated. Every field after
// `messages` is one the inbox webhook processes (odoo-addons/liwan_inbox/adapters/whatsapp.py).
const PERMISSIONS = ['whatsapp_business_messaging', 'whatsapp_business_management']
const WEBHOOK_FIELDS = [
  'messages', 'message_template_status_update', 'message_template_quality_update', 'template_category_update', 'flows',
  'phone_number_quality_update', 'phone_number_name_update', 'account_update', 'business_capability_update', 'account_alerts',
]
const TONES: Record<StepState, 'success' | 'destructive' | 'warning' | 'neutral'> = { todo: 'neutral', done: 'success', problem: 'destructive', pending: 'warning', unchecked: 'neutral' }

const present = (name: string) => props.connection?.secrets.some(secret => secret.name === name && secret.present) ?? false

// The probe reads the business account with the token, so only a connected state proves the token and the account ID.
function tokenStep(connection: IntegrationConnection): Pick<Step, 'state' | 'result'> {
  if (!present('access_token')) return { state: 'todo', result: 'tokenTodo' }
  if (connection.state === 'connected') return { state: 'done', result: 'tokenDone' }
  if (connection.state === 'error') return { state: 'problem', result: 'tokenProblem' }
  return { state: 'pending', result: 'tokenPending' }
}
function valuesStep(connection: IntegrationConnection): Pick<Step, 'state' | 'result'> {
  if (connection.state === 'error') return { state: 'problem', result: 'valuesProblem' }
  if (!present('app_secret')) return { state: 'todo', result: 'valuesTodo' }
  return connection.state === 'connected' ? { state: 'done', result: 'valuesDone' } : { state: 'pending', result: 'tokenPending' }
}
function webhookStep(): Pick<Step, 'state' | 'result'> {
  return present('verify_token') ? { state: 'done', result: 'webhookDone' } : { state: 'todo', result: 'webhookTodo' }
}

const steps = computed<Step[]>(() => {
  const connection = props.connection
  const unchecked: Pick<Step, 'state' | 'result'> = { state: 'unchecked', result: '' }
  const none: Pick<Step, 'state' | 'result'> = { state: null, result: '' }
  return [
    { key: 'app', ...(connection ? unchecked : none) },
    { key: 'token', ...(connection ? tokenStep(connection) : none) },
    { key: 'values', ...(connection ? valuesStep(connection) : none) },
    { key: 'webhook', ...(connection ? webhookStep() : none) },
    { key: 'fields', ...(connection ? unchecked : none) },
  ]
})
</script>

<template>
  <SharedRecordSection id="guide" variant="panel" :title="t('integrations.guide.title')" :description="t('integrations.guide.hint')" data-testid="integration-guide">
    <ol class="grid gap-4 text-start">
      <li v-for="(step, index) in steps" :key="step.key" class="flex min-w-0 gap-3" :data-testid="`integration-guide-step-${step.key}`">
        <span class="flex size-7 shrink-0 items-center justify-center rounded-full bg-elevated text-sm font-semibold text-highlighted" :aria-label="t('integrations.guide.stepLabel', { n: index + 1 })">{{ index + 1 }}</span>
        <div class="grid min-w-0 gap-1.5">
          <div class="flex flex-wrap items-center gap-2">
            <h3 class="text-sm font-medium text-highlighted">{{ t(`integrations.guide.steps.${step.key}.title`) }}</h3>
            <SharedStatusBadge v-if="step.state" size="sm" :tone="TONES[step.state]" :label="t(`integrations.guide.state.${step.state}`)" :data-testid="`integration-guide-state-${step.key}`" />
          </div>
          <p class="text-sm text-muted">{{ t(`integrations.guide.steps.${step.key}.body`) }}</p>
          <ul v-if="step.key === 'values'" class="grid gap-1 text-sm text-muted">
            <li v-for="line in ['accountId', 'appId', 'phoneId']" :key="line">{{ t(`integrations.guide.steps.values.${line}`) }}</li>
          </ul>
          <p v-if="step.key === 'webhook'" class="text-sm text-muted">{{ t(connection ? 'integrations.guide.steps.webhook.after' : 'integrations.guide.steps.webhook.before') }}</p>
          <ul v-if="step.key === 'token'" class="flex flex-wrap gap-1.5" dir="ltr" :aria-label="t('integrations.guide.permissions')">
            <li v-for="permission in PERMISSIONS" :key="permission"><code class="rounded-md bg-elevated px-1.5 py-0.5 text-xs text-default">{{ permission }}</code></li>
          </ul>
          <ul v-if="step.key === 'fields'" class="flex flex-wrap gap-1.5" dir="ltr">
            <li v-for="field in WEBHOOK_FIELDS" :key="field"><code class="rounded-md bg-elevated px-1.5 py-0.5 text-xs text-default">{{ field }}</code></li>
          </ul>
          <p v-if="step.result" class="text-sm text-default" :data-testid="`integration-guide-result-${step.key}`">{{ t(`integrations.guide.result.${step.result}`) }}</p>
        </div>
      </li>
    </ol>
  </SharedRecordSection>
</template>
