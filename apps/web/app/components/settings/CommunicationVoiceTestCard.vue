<script setup lang="ts">
import { formatDateTime } from '@liwan/ui/app/utils/formatDate'
import CommunicationCallStatus from '@/components/settings/CommunicationCallStatus.vue'
import { ApiError } from '@/composables/useApi'
import { useIntegrationSenders, usePlaceTestCall, useTestCall } from '@/composables/useIntegrationCommunications'
import { integrationErrorText, integrationServerMessage } from '@/utils/integrationLabels'
import type { IntegrationVoiceTest } from '@liwan/contracts'
import { callIsFinal } from '@/utils/integrationVoice'

// The voice test: place one call and watch it move (initiated, ringing, in_progress, then a final state). `speak`
// says a text to the recipient (a fixed Arabic sentence when no text is given); `bridge` calls the agent's number
// first and dials the recipient in when the agent answers, so it carries no text and no language. A call is never
// placed again automatically and there is no retry route: an `unconfirmed` one warns to check Twilio first. The test
// routes need integrations.manage and not the log capability.
const props = defineProps<{ canManage: boolean }>()
const { t } = useI18n()
const hydrated = useHydrated()
const idBase = useId()

const senders = useIntegrationSenders({ channel: 'voice', active: true, page: 1 }, () => props.canManage)
const senderItems = computed(() => (senders.data.value?.items ?? [])
  .map(sender => ({ label: sender.value, value: sender.id })))
const place = usePlaceTestCall()

const senderId = ref<number | undefined>(undefined)
watch(senderItems, items => { if (senderId.value === undefined && items.length === 1) senderId.value = items[0]!.value }, { immediate: true })
const to = ref('')
const mode = ref<'speak' | 'bridge'>('speak')
const text = ref('')
const agentNumber = ref('')
const language = ref<'ar' | 'ar-AE'>('ar')
const fieldErrors = ref<Record<string, string>>({})
const failure = ref('')

const testId = ref<number | null>(null)
const result = useTestCall(testId)
const call = computed(() => (testId.value === null ? undefined : result.data.value))
const polling = computed(() => call.value !== undefined && !callIsFinal(call.value) && result.isFetching.value)
const busy = computed(() => !hydrated.value || !props.canManage || place.isPending.value)
const dirty = computed(() => Boolean(to.value.trim() || text.value.trim() || agentNumber.value.trim()))
const TEXT_MAX = 500

const E164 = /^\+[1-9]\d{6,14}$/
const modeItems = [
  { label: t('integrations.communications.voice.modeSpeak'), value: 'speak' },
  { label: t('integrations.communications.voice.modeBridge'), value: 'bridge' },
]
const languageItems = computed(() => [
  { label: t('integrations.communications.voice.languageAr'), value: 'ar' },
  { label: t('integrations.communications.voice.languageArAE'), value: 'ar-AE' },
])
const focusField = async (name: string) => { await nextTick(); document.getElementById(`${idBase}-${name}`)?.focus() }

async function submit() {
  if (busy.value) return
  failure.value = ''
  fieldErrors.value = {}
  const number = to.value.trim().replace(/[\s-]/g, '')
  const agent = agentNumber.value.trim().replace(/[\s-]/g, '')
  const problems: Record<string, string> = {}
  if (!E164.test(number)) problems.to = t('integrations.communications.test.toInvalid')
  if (mode.value === 'bridge' && !E164.test(agent)) problems.agent_number = t('integrations.communications.test.toInvalid')
  const spoken = text.value.trim()
  if (mode.value === 'speak' && spoken.length > TEXT_MAX) problems.text = t('integrations.communications.voice.textTooLong', { max: TEXT_MAX })
  const first = Object.keys(problems)[0]
  if (first) {
    fieldErrors.value = problems
    return focusField(first)
  }
  const body: IntegrationVoiceTest = {
    to: number,
    mode: mode.value,
    ...(senderId.value !== undefined ? { sender_id: senderId.value } : {}),
    ...(mode.value === 'speak'
      ? { ...(spoken ? { text: spoken } : {}), ...(language.value !== 'ar' ? { language: language.value } : {}) }
      : { agent_number: agent }),
  }
  try {
    testId.value = (await place.mutateAsync(body)).id
  } catch (error) {
    const field = error instanceof ApiError ? error.field : undefined
    if (field && ['to', 'sender_id', 'text', 'agent_number', 'language', 'mode'].includes(field)) fieldErrors.value = { [field]: integrationServerMessage(error) || integrationErrorText(error, t) }
    else failure.value = integrationErrorText(error, t)
  }
}
</script>

<template>
  <SharedRecordSection id="voice-test" variant="panel" class="liwan-settings-anchor" :title="t('integrations.communications.voice.title')" :description="t('integrations.communications.voice.hint')" data-testid="communication-voice">
    <SharedPageState empty-icon="i-lucide-phone" :loading="senders.isLoading.value" :error="senders.error.value" :empty="canManage && senderItems.length === 0" :empty-text="t('integrations.communications.voice.noSender')" :empty-description="t('integrations.communications.voice.noSenderHint')" @retry="senders.refetch()">
      <SharedForbiddenState v-if="!canManage" :description="t('integrations.errors.forbidden')" />
      <div v-else class="grid gap-4 text-start">
        <UForm :state="{ senderId, to, mode, text, agentNumber }" class="grid gap-4" novalidate :loading-auto="false" @submit="submit">
          <SharedUnsavedChanges :dirty="dirty && testId === null" />
          <UFormField :label="t('integrations.communications.voice.sender')" name="sender_id" :error="fieldErrors.sender_id">
            <USelect :id="`${idBase}-sender_id`" v-model="senderId" :items="senderItems" dir="ltr" class="w-full" :placeholder="t('integrations.communications.voice.senderPlaceholder')" :disabled="busy" data-testid="communication-voice-sender" />
          </UFormField>
          <UFormField :label="t('integrations.communications.test.to')" :description="t('integrations.communications.test.toHint')" name="to" required :error="fieldErrors.to">
            <UInput :id="`${idBase}-to`" v-model="to" type="tel" dir="ltr" autocomplete="off" class="w-full" :disabled="busy" data-testid="communication-voice-to" />
          </UFormField>
          <SharedSegmentedControl v-model="mode" :label="t('integrations.communications.voice.mode')" :items="modeItems" :disabled="busy" data-testid="communication-voice-mode" />
          <template v-if="mode === 'speak'">
            <UFormField :label="t('integrations.communications.voice.text')" :description="t('integrations.communications.voice.textHint', { max: TEXT_MAX })" name="text" :error="fieldErrors.text">
              <UTextarea :id="`${idBase}-text`" v-model="text" :rows="3" :maxlength="TEXT_MAX" class="w-full" :disabled="busy" data-testid="communication-voice-text" />
            </UFormField>
            <UFormField :label="t('integrations.communications.voice.language')" name="language" :error="fieldErrors.language">
              <USelect :id="`${idBase}-language`" v-model="language" :items="languageItems" class="w-full sm:max-w-48" :disabled="busy" data-testid="communication-voice-language" />
            </UFormField>
          </template>
          <template v-else>
            <UFormField :label="t('integrations.communications.voice.agentNumber')" :description="t('integrations.communications.voice.agentNumberHint')" name="agent_number" required :error="fieldErrors.agent_number">
              <UInput :id="`${idBase}-agent_number`" v-model="agentNumber" type="tel" dir="ltr" autocomplete="off" class="w-full" :disabled="busy" data-testid="communication-voice-agent" />
            </UFormField>
            <p class="text-sm text-muted" data-testid="communication-voice-bridge-hint">{{ t('integrations.communications.voice.bridgeHint') }}</p>
          </template>
          <UAlert v-if="failure" role="alert" color="error" variant="subtle" :title="failure" data-testid="communication-voice-error" />
          <div class="flex justify-end">
            <UButton type="submit" color="primary" icon="i-lucide-phone-outgoing" :disabled="busy" :loading="place.isPending.value" :label="t('integrations.communications.voice.place')" data-testid="communication-voice-place" />
          </div>
        </UForm>
        <div v-if="testId !== null" class="grid gap-3 rounded-card border border-default p-(--liwan-card-pad-dense)" aria-live="polite" data-testid="communication-voice-result">
          <SharedPageState :loading="result.isLoading.value && !call" :error="result.error.value" @retry="result.refetch()">
            <template v-if="call">
              <div class="flex flex-wrap items-baseline justify-between gap-2">
                <p class="min-w-0 text-sm text-highlighted"><bdi dir="ltr">{{ call.from_value }}</bdi> → <bdi dir="ltr">{{ call.to }}</bdi></p>
                <p class="text-xs text-muted">{{ formatDateTime(call.created_at) }}</p>
              </div>
              <CommunicationCallStatus :call="call" />
              <div v-if="!callIsFinal(call)" class="flex flex-wrap items-center gap-2">
                <UButton size="sm" color="neutral" variant="outline" icon="i-lucide-refresh-cw" :disabled="!hydrated || result.isFetching.value" :loading="polling" :label="t('integrations.communications.test.refresh')" data-testid="communication-voice-refresh" @click="result.refetch()" />
              </div>
            </template>
          </SharedPageState>
        </div>
      </div>
    </SharedPageState>
  </SharedRecordSection>
</template>
