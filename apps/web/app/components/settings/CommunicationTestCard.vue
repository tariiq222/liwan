<script setup lang="ts">
import { formatDateTime } from '@liwan/ui/app/utils/formatDate'
import CommunicationMessageStatus from '@/components/settings/CommunicationMessageStatus.vue'
import { ApiError } from '@/composables/useApi'
import { useIntegrationSenders, useRetryMessage, useSendTestMessage, useTestMessage } from '@/composables/useIntegrationCommunications'
import { integrationErrorText, integrationServerMessage } from '@/utils/integrationLabels'
import type { IntegrationMessageStateView, IntegrationMessagingTest } from '@liwan/contracts'
import { messageIsFinal, parseTemplateVariables } from '@/utils/integrationMessaging'

// The messaging test: send one message from a sender of the company and watch it move (queued, sent, delivered). A
// free-text test carries a fixed Arabic body written by the server, so the form collects only the sender and the number;
// a template test adds the approved template's SID and its variables. The test routes need integrations.manage and not
// the log capability, so an admin can send and watch a test without reading the company's messages. Retrying a failed or
// unconfirmed message is a log action: it also needs the log capability (`canRetry`).
const props = defineProps<{ canManage: boolean, canRetry: boolean }>()
const { t } = useI18n()
const hydrated = useHydrated()
const idBase = useId()

const senders = useIntegrationSenders({ active: true, page: 1 }, () => props.canManage)
const senderItems = computed(() => (senders.data.value?.items ?? []).filter(sender => sender.channel === 'sms' || sender.channel === 'whatsapp')
  .map(sender => ({ label: `${sender.value} · ${t(`integrations.communications.channel.${sender.channel}`)}`, value: sender.id })))
const send = useSendTestMessage()
const retry = useRetryMessage()

const senderId = ref<number | undefined>(undefined)
watch(senderItems, items => { if (senderId.value === undefined && items.length === 1) senderId.value = items[0]!.value }, { immediate: true })
const to = ref('')
const mode = ref('text')
const contentSid = ref('')
const variables = ref('')
const fieldErrors = ref<Record<string, string>>({})
const failure = ref('')

const testId = ref<number | null>(null)
const result = useTestMessage(testId)
const message = computed<IntegrationMessageStateView | undefined>(() => (testId.value === null ? undefined : result.data.value))
const polling = computed(() => message.value !== undefined && !messageIsFinal(message.value) && result.isFetching.value)
const busy = computed(() => !hydrated.value || !props.canManage || send.isPending.value)
const dirty = computed(() => Boolean(to.value.trim() || contentSid.value.trim() || variables.value.trim()))

const modeItems = computed(() => [
  { label: t('integrations.communications.test.modeText'), value: 'text' },
  { label: t('integrations.communications.test.modeTemplate'), value: 'template' },
])
const E164 = /^\+[1-9]\d{6,14}$/
const CONTENT_SID = /^HX[0-9a-fA-F]{32}$/
const focusField = async (name: string) => { await nextTick(); document.getElementById(`${idBase}-${name}`)?.focus() }

async function submit() {
  if (busy.value) return
  failure.value = ''
  fieldErrors.value = {}
  const number = to.value.trim().replace(/[\s-]/g, '')
  const problems: Record<string, string> = {}
  if (senderId.value === undefined) problems.sender_id = t('integrations.communications.test.senderRequired')
  if (!E164.test(number)) problems.to = t('integrations.communications.test.toInvalid')
  const vars = mode.value === 'template' ? parseTemplateVariables(variables.value) : {}
  if (mode.value === 'template' && !CONTENT_SID.test(contentSid.value.trim())) problems.content_sid = t('integrations.communications.test.templateInvalid')
  if (vars === null) problems.content_variables = t('integrations.communications.test.variablesInvalid')
  const first = Object.keys(problems)[0]
  if (first) {
    fieldErrors.value = problems
    return focusField(first)
  }
  const body: IntegrationMessagingTest = {
    sender_id: senderId.value as number,
    to: number,
    ...(mode.value === 'template' ? { content_sid: contentSid.value.trim(), ...(vars && Object.keys(vars).length ? { content_variables: vars } : {}) } : {}),
  }
  try {
    testId.value = (await send.mutateAsync(body)).id
  } catch (error) {
    const field = error instanceof ApiError ? error.field : undefined
    if (field && ['to', 'sender_id', 'content_sid', 'content_variables'].includes(field)) fieldErrors.value = { [field]: integrationServerMessage(error) || integrationErrorText(error, t) }
    else failure.value = integrationErrorText(error, t)
  }
}

async function retryMessage() {
  const current = message.value
  if (!current) return
  failure.value = ''
  try {
    testId.value = (await retry.mutateAsync(current.id)).id
  } catch (error) {
    failure.value = integrationErrorText(error, t)
  }
}
</script>

<template>
  <SharedRecordSection id="test" variant="panel" class="liwan-settings-anchor" :title="t('integrations.communications.test.title')" :description="t('integrations.communications.test.hint')" data-testid="communication-test">
    <SharedPageState empty-icon="i-lucide-message-square-text" :loading="senders.isLoading.value" :error="senders.error.value" :empty="canManage && senderItems.length === 0" :empty-text="t('integrations.communications.test.noSender')" :empty-description="t('integrations.communications.test.noSenderHint')" @retry="senders.refetch()">
      <SharedForbiddenState v-if="!canManage" :description="t('integrations.errors.forbidden')" />
      <div v-else class="grid gap-4 text-start">
        <UForm :state="{ senderId, to, mode, contentSid }" class="grid gap-4" novalidate :loading-auto="false" @submit="submit">
          <SharedUnsavedChanges :dirty="dirty && testId === null" />
          <UFormField :label="t('integrations.communications.test.sender')" name="sender_id" required :error="fieldErrors.sender_id">
            <USelect :id="`${idBase}-sender_id`" v-model="senderId" :items="senderItems" dir="ltr" class="w-full" :placeholder="t('integrations.communications.test.senderPlaceholder')" :disabled="busy" data-testid="communication-test-sender" />
          </UFormField>
          <UFormField :label="t('integrations.communications.test.to')" :description="t('integrations.communications.test.toHint')" name="to" required :error="fieldErrors.to">
            <UInput :id="`${idBase}-to`" v-model="to" type="tel" dir="ltr" autocomplete="off" class="w-full" :disabled="busy" data-testid="communication-test-to" />
          </UFormField>
          <SharedSegmentedControl v-model="mode" :label="t('integrations.communications.test.mode')" :items="modeItems" :disabled="busy" data-testid="communication-test-mode" />
          <p v-if="mode === 'text'" class="text-sm text-muted" data-testid="communication-test-text-hint">{{ t('integrations.communications.test.textHint') }}</p>
          <template v-else>
            <UFormField :label="t('integrations.communications.test.template')" :description="t('integrations.communications.test.templateHint')" name="content_sid" required :error="fieldErrors.content_sid">
              <UInput :id="`${idBase}-content_sid`" v-model="contentSid" dir="ltr" autocomplete="off" class="w-full" :disabled="busy" data-testid="communication-test-template" />
            </UFormField>
            <UFormField :label="t('integrations.communications.test.variables')" :description="t('integrations.communications.test.variablesHint')" name="content_variables" :error="fieldErrors.content_variables">
              <UTextarea :id="`${idBase}-content_variables`" v-model="variables" dir="ltr" :rows="3" class="w-full" :disabled="busy" data-testid="communication-test-variables" />
            </UFormField>
          </template>
          <UAlert v-if="failure" role="alert" color="error" variant="subtle" :title="failure" data-testid="communication-test-error" />
          <div class="flex justify-end">
            <UButton type="submit" color="primary" icon="i-lucide-send" :disabled="busy" :loading="send.isPending.value" :label="t('integrations.communications.test.send')" data-testid="communication-test-send" />
          </div>
        </UForm>
        <div v-if="testId !== null" class="grid gap-3 rounded-card border border-default p-(--liwan-card-pad-dense)" aria-live="polite" data-testid="communication-test-result">
          <SharedPageState :loading="result.isLoading.value && !message" :error="result.error.value" @retry="result.refetch()">
            <template v-if="message">
              <div class="flex flex-wrap items-baseline justify-between gap-2">
                <p class="min-w-0 text-sm text-highlighted"><bdi dir="ltr">{{ message.sender_value }}</bdi> → <bdi dir="ltr">{{ message.to }}</bdi></p>
                <p class="text-xs text-muted">{{ formatDateTime(message.sent_at ?? message.created_at) }}</p>
              </div>
              <CommunicationMessageStatus :message="message" :can-retry="canRetry" :retrying="retry.isPending.value" @retry="retryMessage" />
              <div v-if="!messageIsFinal(message)" class="flex flex-wrap items-center gap-2">
                <UButton size="sm" color="neutral" variant="outline" icon="i-lucide-refresh-cw" :disabled="!hydrated || result.isFetching.value" :loading="polling" :label="t('integrations.communications.test.refresh')" data-testid="communication-test-refresh" @click="result.refetch()" />
              </div>
            </template>
          </SharedPageState>
        </div>
      </div>
    </SharedPageState>
  </SharedRecordSection>
</template>
