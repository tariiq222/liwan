<script setup lang="ts">
import { IntegrationCommunicationSettingsUpdateSchema } from '@liwan/contracts'
import { ApiError } from '@/composables/useApi'
import { useCommunicationSettings, useUpdateCommunicationSettings } from '@/composables/useIntegrationCommunications'
import { integrationErrorText, integrationServerMessage } from '@/utils/integrationLabels'

// The company's communication safety settings: the daily message limit, the daily call limit and call recording. The
// limits are the safety stops that protect the Twilio balance from a loop; the server counts the day's messages and
// calls from the log and refuses the next one once a limit is reached. Recording places recorded calls only after the
// company turns it on, and only the recording reference is ever stored, never audio. The PATCH is partial: only the
// changed values travel. The server's answer replaces the cached value, so the card shows what is stored. Reading
// needs integrations.read; changing needs integrations.manage.
const props = defineProps<{ canManage: boolean }>()
const { t } = useI18n()
const hydrated = useHydrated()
const toast = useToast()
const settings = useCommunicationSettings()
const update = useUpdateCommunicationSettings()
const idBase = useId()
// The limits of the contract.
const MESSAGE_MAX = 100_000
const CALL_MAX = 10_000

const messageDraft = ref('')
const callDraft = ref('')
const recordCalls = ref(false)
const fieldErrors = ref<Record<string, string>>({})
const saved = ref(false)
const stored = computed(() => settings.data.value)
watch(stored, value => {
  if (value === undefined) return
  messageDraft.value = String(value.daily_message_limit)
  callDraft.value = String(value.daily_call_limit)
  recordCalls.value = value.record_calls
}, { immediate: true })
const storedRecordCalls = computed(() => stored.value?.record_calls)
const changed = computed(() => {
  if (!stored.value) return false
  const message = /^\d+$/.test(messageDraft.value.trim()) ? Number(messageDraft.value.trim()) : null
  const call = /^\d+$/.test(callDraft.value.trim()) ? Number(callDraft.value.trim()) : null
  return message !== stored.value.daily_message_limit || call !== stored.value.daily_call_limit || recordCalls.value !== stored.value.record_calls
})
const locked = computed(() => !hydrated.value || !props.canManage || update.isPending.value)
watch([messageDraft, callDraft, recordCalls], () => { fieldErrors.value = {}; saved.value = false })

async function save() {
  if (locked.value || !changed.value) return
  fieldErrors.value = {}
  const message = /^\d+$/.test(messageDraft.value.trim()) ? Number(messageDraft.value.trim()) : null
  const call = /^\d+$/.test(callDraft.value.trim()) ? Number(callDraft.value.trim()) : null
  const body: Record<string, unknown> = {}
  if (message !== stored.value?.daily_message_limit) body.daily_message_limit = message
  if (call !== stored.value?.daily_call_limit) body.daily_call_limit = call
  if (recordCalls.value !== stored.value?.record_calls) body.record_calls = recordCalls.value
  if (!IntegrationCommunicationSettingsUpdateSchema.safeParse(body).success) {
    const messageInvalid = message === null || (typeof body.daily_message_limit === 'number' && (body.daily_message_limit < 1 || body.daily_message_limit > MESSAGE_MAX))
    const callInvalid = call === null || (typeof body.daily_call_limit === 'number' && (body.daily_call_limit < 1 || body.daily_call_limit > CALL_MAX))
    fieldErrors.value = {
      daily_message_limit: messageInvalid ? t('integrations.communications.limit.invalid', { min: 1, max: MESSAGE_MAX }) : '',
      daily_call_limit: callInvalid ? t('integrations.communications.limit.callInvalid', { min: 1, max: CALL_MAX }) : '',
    }
    document.getElementById(`${idBase}-${messageInvalid ? 'message_limit' : 'call_limit'}`)?.focus()
    return
  }
  try {
    await update.mutateAsync(body)
    saved.value = true
    toast.add({ title: t('integrations.communications.limit.saved'), color: 'success' })
  } catch (failure) {
    const field = failure instanceof ApiError ? failure.field : undefined
    if (field === 'daily_message_limit' || field === 'daily_call_limit') {
      fieldErrors.value = {
        [field]: integrationServerMessage(failure) || t(field === 'daily_message_limit' ? 'integrations.communications.limit.invalid' : 'integrations.communications.limit.callInvalid', field === 'daily_message_limit' ? { min: 1, max: MESSAGE_MAX } : { min: 1, max: CALL_MAX }),
      }
    } else fieldErrors.value = { form: integrationErrorText(failure, t) }
  }
}
</script>

<template>
  <SharedRecordSection id="limit" variant="panel" class="liwan-settings-anchor" :title="t('integrations.communications.limit.title')" :description="t('integrations.communications.limit.hint')" data-testid="communication-limit">
    <SharedPageState :loading="settings.isLoading.value" :error="settings.error.value" @retry="settings.refetch()">
      <UForm :state="{ messageDraft, callDraft, recordCalls }" class="grid gap-4 text-start" novalidate :loading-auto="false" @submit="save">
        <SharedUnsavedChanges :dirty="changed && canManage" />
        <UFormField :label="t('integrations.communications.limit.label')" :description="t('integrations.communications.limit.fieldHint', { min: 1, max: MESSAGE_MAX })" name="daily_message_limit" :error="fieldErrors.daily_message_limit">
          <UInput :id="`${idBase}-message_limit`" v-model="messageDraft" type="text" inputmode="numeric" dir="ltr" class="w-full sm:max-w-48" :disabled="locked" data-testid="communication-limit-input" />
        </UFormField>
        <UFormField :label="t('integrations.communications.limit.callLabel')" :description="t('integrations.communications.limit.callFieldHint', { min: 1, max: CALL_MAX })" name="daily_call_limit" :error="fieldErrors.daily_call_limit">
          <UInput :id="`${idBase}-call_limit`" v-model="callDraft" type="text" inputmode="numeric" dir="ltr" class="w-full sm:max-w-48" :disabled="locked" data-testid="communication-limit-call-input" />
        </UFormField>
        <USwitch v-model="recordCalls" :label="t('integrations.communications.limit.recordCalls')" :description="t('integrations.communications.limit.recordCallsHint')" :disabled="locked" data-testid="communication-limit-record-calls" />
        <UAlert v-if="fieldErrors.form" role="alert" color="error" variant="subtle" :title="fieldErrors.form" data-testid="communication-limit-error" />
        <div v-if="canManage" class="flex flex-wrap items-center justify-end gap-3">
          <p v-if="saved && !changed" class="text-sm text-muted" role="status" data-testid="communication-limit-saved">{{ t('integrations.communications.limit.saved') }}</p>
          <UButton type="submit" color="primary" :disabled="locked || !changed" :loading="update.isPending.value" :label="t('integrations.communications.limit.save')" data-testid="communication-limit-save" />
        </div>
      </UForm>
    </SharedPageState>
  </SharedRecordSection>
</template>
